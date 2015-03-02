(function () {
    var win = window;
    var $ = win.$;
    
    var editor, schema, predefinedFields;
    
    // Step 1. Define default path to file with schema and predefined fields
    var schemaSrc = "js/data/rule.schema.json"; // default path to json schema
    var predefinedSrc = "js/data/rule.predefined.json"; // default path to predefined fields

    // Step 2. If custom path was defined - is it
    if (schemaSrc in win) {
        schemaSrc = win.schemaSrc;    // use custom path if exists
    }
    if (predefinedSrc in win) {
        predefinedSrc = win.predefinedSrc;    // use custom path if exists
    }

    // Step 3. Get data from json files. Call onReady() when schema received
    $.getJSON(schemaSrc, function (data) {
        schema = data;
        $.getJSON(predefinedSrc, function (data) {
            predefinedFields = data;
            onReady();
        });    
    });    
    
    // Init loader
    var loader = new Loader();
    loader.show();

    // Init IframeHelper
    var inno = new IframeHelper();    
    
    var onReady = function () {
        inno.onReady(function () {
            inno.getRules(function (success, rules) {
                if (!success) {
                    alert('Rules were not loaded due to error. Please reload screen.');
                    return;
                }

                inno.getProfileSchemaAttributes(function (els) {
                    mappingTypeValues.profileAttribute = prepareEls(els);

                    inno.getProfileSchemaEventDefinitions(function (els) {
                        var newEls = prepareEls(els);
                        var eventSchema = schema.items.properties.event;

                        mappingTypeValues.event = newEls;

                        eventSchema.enum = newEls[0];
                        if (!eventSchema.options) {
                            eventSchema.options = {};
                        }
                        eventSchema.options.enum_titles = newEls[1];

                        /**
                         * JSON Schema -> HTML Editor
                         * https://github.com/jdorn/json-editor/
                         */
                        editor = new JSONEditor($('#form-setting')[0], {
                            disable_collapse: true,
                            disable_edit_json: true,
                            disable_properties: true,
                            disable_array_reorder: true,
                            no_additional_properties: true,
                            schema: schema,
                            //startval: predefinedFields,
                            required: [],
                            required_by_default: true,
                            theme: 'bootstrap3'
                        });
                        editor.on('change', function () {
                            var eventRegexp = /^root\.\d+\.event$/;
                            var mappingTypeRegexp = /^root\.\d+\.fieldSets\.\d+\.fields\.\d+\.type$/;
                            var editors = editor.editors;
                            var path;
                            for (path in editors) {
                                if (eventRegexp.test(path)) {
                                    changeEvent(path);
                                }

                                if (mappingTypeRegexp.test(path)) {
                                    changeMappingTypeAndValue(path);
                                }
                            }

                            completeRule();
                            fixPredefinedFields();
                        });

                        completeRule(rules);
                        fixPredefinedFields();

                        loader.hide();
                    });
                });
            });
        });
    };
    
    var mappingTypeValues = {
        profileAttribute: [],
        sessionValue: [],
        eventValue: [],
        macro: [
            ['timestamp_now','request_ip','user_agent','profileId'],
            ['Timestamp','Request IP','User-agent','Profile ID']
        ],
        meta: [
            ['company_id','bucket_id','event_def_id','app_section_event','collect_app','section'],
            ['Company ID','Bucket ID','Event definition ID','Event with scope','Collect app','Section']
        ],
        event: []
    };
    
    var changeEvent = function (path) {
        var eventField = editor.getEditor(path);
        if (!eventField) {
            return;
        }
        
        var newValue = eventField.getValue();
        var parts, appId, sectionId, eventId;
        
        if (!eventField.oldValue || !newValue) {
            return;
        }
        
        parts = newValue.split('/');
        appId = parts[0];
        sectionId = parts[1];
        eventId = parts[2];

        inno.getProfileSchemaSessionDatas(appId, sectionId, function (els) {
            mappingTypeValues.sessionValue = prepareEls(els);
        });        

        inno.getProfileSchemaEventDefinitionDatas(appId, sectionId, eventId, function (els) {
            mappingTypeValues.eventValue = prepareEls(els);
        });
        
        eventField.oldValue = newValue;
    };
    var changeMappingTypeAndValue = function (path) {
        var typeField, newValue;
        typeField = editor.getEditor(path);
        if (!typeField) {
            return;
        }
        
        newValue = typeField.getValue();
        if (!typeField.oldValue) {
            typeField.oldValue = newValue;
        }
        
        var valuePath = typeField.parent.path + '.value';
        var valueField = editor.getEditor(valuePath);
        var oldEnumValues = '' + valueField.schema.enum;
        var newEnumValues = mappingTypeValues[newValue];
        
        // if type was not changed and select options are the same GO OUT
        if (typeField.oldValue === newValue && (oldEnumValues === '' + newEnumValues || oldEnumValues === '' + newEnumValues[0])) {
            return;
        }

        changeEnumValues(valuePath, newEnumValues);
        typeField.oldValue = newValue;
    };
    var changeEnumValues = function (path, enumValues) {
        var oldField = editor.getEditor(path);
        var oldValue = oldField.getValue();
        var fieldName = oldField.key;
        var parent = oldField.parent;
        
        oldField.destroy();

        delete parent.editors[fieldName];
        delete parent.cached_editors[fieldName];
        
        var fieldSchema = parent.schema.properties[fieldName];
        if (enumValues) {
            fieldSchema.enum = enumValues[0] || enumValues;
            if (!fieldSchema.options) {
                fieldSchema.options = {};
            }
            
            fieldSchema.options.enum_titles = enumValues[1];
        } else {
            delete fieldSchema.enum;
        }

        parent.addObjectProperty(fieldName);
        
        var newField = editor.getEditor(path);
        var newValue = enumValues && enumValues.indexOf(oldValue) === -1 ? '' : oldValue;
        newField.setValue(newValue);
    };
    var prepareEls = function (els) {
        var newEls = [[], []];
        els.forEach(function (el) {
            newEls[0].push(el);
            newEls[1].push(el.split('/').join(' / '));
        });
        return newEls;
    };
    
    /**
     * Complete new rule with default values
     */
    var completeRule = function (rules) {
        rules = rules || editor.getValue();
        var newRules = [];
        if (!editor.savedValue || editor.savedValue.length < rules.length) {
            rules.forEach(function (rule) {
                newRules.push(
                    $.extend(true, {}, predefinedFields, rule)
                );
            });

            editor.setValue(newRules);
        }
        
        editor.savedValue = newRules.length ? newRules : rules;
        
        // empty row cache
        if (!rules.length) {
            editor.getEditor('root').empty(true);
        }
    };
    /**
     * Fix predefined fields
     */
    var fixPredefinedFields = function () {
        var rules = editor.getValue();
        
        // remove controls from predefined fields
        rules.forEach(function (rule, ruleIdx) {
            predefinedFields.fieldSets.forEach(function (fs, fsIdx) {
                var fieldPath = ['root', ruleIdx, 'fieldSets', fsIdx, 'fields'].join('.');
                var field = editor.getEditor(fieldPath);
                if (field) {
                    field.delete_last_row_button.style.display = 'none';
                    field.remove_all_rows_button.style.display = 'none';
                }

                fs.fields.forEach(function (f, fIdx) {
                    var fieldPath = ['root', ruleIdx, 'fieldSets', fsIdx, 'fields', fIdx].join('.');
                    var field = editor.getEditor(fieldPath);
                    if (field) {
                        field.delete_button.style.display = 'none';
                    }
                    
                    // readonly for predefined fields names
                    field.editors.fieldName.input.readOnly = true;
                });
            });
        });
    };

    // Listen submit button click event
    $('#submit-setting').on('click', function () {
        var errors = editor.validate();
        if (errors.length) {
            errors = errors.map(function (error) {
                var field = editor.getEditor(error.path),
                    title = field.schema.title;
                return title + ': ' + error.message;
            });
            alert(errors.join('\n'));
        } else {
            loader.show();
            inno.setRules(editor.getValue(), function (success) {
                loader.hide();
                if (success) {
                    alert('Rules were successfully saved.');
                }
            });
        }
    });

})();