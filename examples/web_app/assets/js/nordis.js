if (!window.sNordisHost) window.sNordisHost = '';
if (!window.aAngularMods) window.aAngularMods = [];
angular.module('nordis', window.aAngularMods)
    .directive('onKeyup', function($parse) {
        return function(scope, elm, attrs) {
            var keyupFn = $parse(attrs.onKeyup);
            elm.bind('keyup', function(evt) {
                if (!attrs.keys)
                    scope.$apply(function() {
                        keyupFn(scope);
                    });
                else {
                    var aKeys = attrs.keys.replace('[','').replace(']','').split(',');
                    for (var i = 0; i < aKeys.length; i++) {
                        if (evt.which == aKeys[i]) {
                            scope.$apply(function() {
                                keyupFn(scope);
                            });
                            break;
                        }
                    }
                }
            });
        };
    })
    .factory('helpers',function($rootScope,$http,$location){
        var self = this;

        $rootScope.$watch(function() {
            return $location.path();
        }, function(newValue, oldValue) {
            if (newValue.match(/^\//))
                newValue = newValue.replace('/','');
            $rootScope.$broadcast('onForceNav',newValue);
        }, true);

        return {
            // This function finds the index of an item in a collection.
            findIndex:function(hOpts,aItems) {
                if (aItems)
                    for (var i = 0; i < aItems.length; i++) {
                        var bPass = true;
                        for (var sKey in hOpts) {
                            if (hOpts[sKey] != aItems[i][sKey])
                                bPass = false;
                        }
                        if (bPass) return i;
                    }
            },
            // Remove an item from a collection. Just pass in the object and the collection.
            remove:function(hItem,cColl,sKey) {
                sKey = (sKey) ? sKey : 'id';
                if (hItem && hItem[sKey] && cColl && cColl.aObjects) {
                    var hLookup = {};hLookup[sKey] = hItem[sKey];
                    var i = this.findIndex(hLookup,cColl.aObjects);
                    if (i) cColl.aObjects.splice(i,1);
                }
            }
            // Update a collection with an item, if the item already exists it is replaced.
            ,update:function(hItem,cColl,sKey) {
                sKey = (sKey) ? sKey : 'id';
                if (cColl) {
                    if (!cColl.aObjects) cColl.aObjects = [];
                    var hLookup = {};hLookup[sKey] = hItem[sKey];
                    var i = this.findIndex(hLookup,cColl.aObjects);
                    if (i >= 0)
                        cColl.aObjects.splice(i,1,hItem);
                    else if (!hItem.bRemoved) {
                        cColl.aObjects.push(hItem);
                        return true;
                    }
                }
                return;
            },
            // Emit an event from any controller to the root scope.
            emit:function(sEvent,Value,Value2,Value3) {
                $rootScope.$broadcast(sEvent,Value,Value2,Value3);
            },
            // I use this to display an alert modal with option buttons.
            confirmCommand: function(hOpts,fnCallback,fnNoCallback) {
                this.emit('onConfirm',hOpts,fnCallback,fnNoCallback);
            },
            // Used to handle error messages and such. The event handler is in the header.dot partial.
            alert:function(hMsg) {
                this.emit('onAlert',hMsg);
            },
            // Grab items from the query string.
            query:function(name) {
                name = name.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]");
                var regexS = "[\\?&]" + name + "=([^&#]*)";
                var regex = new RegExp(regexS);
                var results = regex.exec(window.location.search);
                if(results == null) {
                    return "";
                } else
                    return decodeURIComponent(results[1].replace(/\+/g, " "));
            },
            // Load a collection via api call.
            loadPage:function(cColl,fnResultHandler,fnErrorHandler){
                var self = this;
                var hData = (cColl.hData) ? cColl.hData : {};
                hData.nSize = cColl.nSize;
                hData.nFirstID = cColl.nNextID;
                if (cColl.hExtras) hData.hExtras = cColl.hExtras;

                self.get({sPath:cColl.sPath,hData:hData,bShowLoader:cColl.bShowLoader,oObj:cColl},function(hResult){
                    cColl.nTotal = hResult.nTotal;
                    cColl.nSize = hResult.nSize;
                    cColl.nCount = hResult.nCount;
                    cColl.nNextID = hResult.nNextID;
                    if (!cColl.aObjects) cColl.aObjects = [];
                    delete hResult.nFirstID;

                    if (hResult.aObjects) {
                        for (var i = 0; i < hResult.aObjects.length; i++) {
                            self.update(hResult.aObjects[i],cColl);
                        }
                    }
                    if (fnResultHandler)
                        fnResultHandler(hResult);
                },function(hResult,nStatus){
                    if (fnErrorHandler)
                        fnErrorHandler(hResult,nStatus);
                    else
                        console.log(hResult);
                });
            },
            // When a collection has an nNextID property from the API, it means there are more items.
            // Just call this method to get the next page.
            next:function(cColl,fnResultHandler,fnErrorHandler) {
                var self = this;
                if ((cColl.nNextID || cColl.nMin) && !cColl.bLoading) {
                    if (cColl.nNextID) cColl.nFirstID = cColl.nNextID;
                    self.loadPage(cColl,fnResultHandler,fnErrorHandler);
                }
            }
            // Handles GET requests to the API.
            ,get:function(hOpts,fnCallback,fnErrorHandler){
                hOpts.sMethod = 'GET';
                if (hOpts.hExtras) {
                    if (!hOpts.hData) hOpts.hData = {};
                    hOpts.hData.hExtras = hOpts.hExtras;
                }
                if (hOpts.hData) {
                    // Convert hData into serialized query string.
                    var serialize = function(obj, prefix) {
                        var str = [];
                        for (var p in obj) {
                            var k = prefix ? prefix + "[" + p + "]" : p, v = obj[p];
                            str.push(typeof v == "object" ?
                                serialize(v, k) :
                                encodeURIComponent(k) + "=" + encodeURIComponent(v));
                        }
                        return str.join("&");
                    };

                    hOpts.sPath += '?'
                    for (var sItem in hOpts.hData) {
                        switch (sItem) {
                            case 'nSize':case 'nFirstID':case 'nMin':case 'sTerm':case 'nMax':
                            hOpts.sPath += sItem+'='+hOpts.hData[sItem]+'&';
                            break;
                            case 'hExtras':
                                hOpts.sPath += serialize(hOpts.hData[sItem],sItem)+'&';
                                break;
                        }
                    }
                }
                this.callAPI(hOpts,fnCallback,fnErrorHandler);
            }
            // Handles POST requests to the API.
            ,post:function(hOpts,fnCallback,fnErrorHandler){
                hOpts.sMethod = 'POST';
                if (hOpts.hExtras) {
                    if (!hOpts.hData) hOpts.hData = {};
                    hOpts.hData.hExtras = hOpts.hExtras;
                }
                this.callAPI(hOpts,fnCallback,fnErrorHandler);
            }
            // Handles DELETE requests to the API.
            ,delete:function(hOpts,fnCallback,fnErrorHandler){
                hOpts.sMethod = 'DELETE';
                this.callAPI(hOpts,fnCallback,fnErrorHandler);
            }
            // This method is shared by POST, GET, and DELETE methods.
            ,callAPI:function(hOpts,fnCallback,fnErrorHandler){
                var self = this;
                var sMethod = (hOpts.sMethod && hOpts.sMethod.match(/(GET|POST|DELETE)/)) ? hOpts.sMethod : 'GET';
                if (hOpts.sPath) {
                    if (!hOpts.hData) hOpts.hData = {};

                    self.emit('onLoad');
                    if (hOpts.oObj) hOpts.oObj.bLoading = true;

                    $http[sMethod.toLowerCase()](window.sNordisHost+hOpts.sPath,hOpts.hData)
                        .success(function(hResult,nStatus){
                            if (hOpts.oObj)
                                hOpts.oObj.bLoading = false;

                            self.emit('onUnload');
                            if (hResult && hResult.sException) {
                                if (fnErrorHandler)
                                    fnErrorHandler(hResult);
                                else
                                    self.alert(hResult);
                            } else if (fnCallback)
                                fnCallback(hResult,nStatus);
                        })
                        .error(function(hResult,nStatus){
                            if (hOpts.oObj) hOpts.oObj.bLoading = false;
                            self.emit('onUnload');

                            if (fnErrorHandler)
                                fnErrorHandler(hResult,nStatus);
                            else
                                self.alert(hResult);
                        });
                }
            }
        }
    })
    .filter('startFrom', function() {
        return function(input, start) {
            start = +start; //parse to int
            return input.slice(start);
        }
    })
    .factory('AppConfig',function(helpers){
        return {hClasses:{
            User:{
                hProperties:{"sid":{"sType":"String","bPrimary":true,"nLength":"36","sSample":"YT8iHhr7YT8YT8iHhr7YT8iHhr7YTiHhr7YT"},"created":{"sType":"Timestamp","bOnCreate":true,"sSample":"1389625960"},"updated":{"sType":"Timestamp","bOnUpdate":true,"sSample":"1389625960"},"name":{"sType":"String"},"company_sid":{"sType":"String"},"email":{"sType":"String"},"project_id":{"sType":"Number"},"password":{"sType":"String","bPrivate":true},"type":{"sType":"Number","hOptions":{"SuperAdmin":1000,"Admin":100,"SurveyTaker":30}},"uid":{"sType":"String","bRequired":true,"bUnique":true,"sDescription":"Employee id coming from survey admin upload of csv."},"model":{"sType":"String","sDescription":"Employee assessment of an employee's status as a 'role model' employee or not.","hOptions":{"yes":"yes","no":"no"}},"salesRating":{"sType":"Number"},"DOB":{"sType":"String"},"gender":{"sType":"Number","hOptions":{"male":1,"female":2}},"ethnicity":{"sType":"Number","hOptions":{}},"maritalStatus":{"sType":"Number","hOptions":{}},"parent":{"sType":"Number","hOptions":{"yes":1,"no":0}},"zipCode":{"sType":"String"},"yearsOfEmployment":{"sType":"Number"},"yearToDateQuota":{"sType":"Number"},"educationLevel":{"sType":"Number","hOptions":{"Less than high school":1,"High school graduate":2,"Some college":3,"Trade or professional school":4,"College graduate":5,"Post-graduate work or degree":6}},"income":{"sType":"Number"}}
                ,hApi:{
                    signup:function(hQuery,hData,hExtras,callback){
                        helpers.post({sPath:'/user/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                    ,signin:function(hQuery,hData,hExtras,callback){
                        helpers.post({sPath:'/user/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                    ,del:function(hQuery,hData,hExtras,callback){
                        helpers.delete({sPath:'/user/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                    ,takeover:function(hQuery,hData,hExtras,callback){
                        helpers.post({sPath:'/user/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                    ,responses:function(hQuery,hData,hExtras,callback){
                        helpers.get({sPath:'/user/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                }
            },Company:{
                hProperties:{"sid":{"sType":"String","bPrimary":true,"nLength":12,"sSample":"YT8iHhr7YT8YT8"},"created":{"sType":"Timestamp","bOnCreate":true,"sSample":"1389625960"},"updated":{"sType":"Timestamp","bOnUpdate":true,"sSample":"1389625960"},"name":{"sType":"String","bRequired":true}}
                ,hApi:{
                    save:function(hQuery,hData,hExtras,callback){
                        helpers.post({sPath:'/company/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                    ,del:function(hQuery,hData,hExtras,callback){
                        helpers.delete({sPath:'/company/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                    ,lookup:function(hQuery,hData,hExtras,callback){
                        helpers.get({sPath:'/company/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                    ,list:function(hQuery,hData,hExtras,callback){
                        helpers.get({sPath:'/company/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                    ,saveAdmin:function(hQuery,hData,hExtras,callback){
                        helpers.post({sPath:'/company/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                    ,del:function(hQuery,hData,hExtras,callback){
                        helpers.delete({sPath:'/company/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                }
            },Survey:{
                hProperties:{"sid":{"sType":"String","bPrimary":true,"nLength":"36","sSample":"YT8iHhr7YT8YT8"},"created":{"sType":"Timestamp","bOnCreate":true,"sSample":"1389625960"},"updated":{"sType":"Timestamp","bOnUpdate":true,"sSample":"1389625960"},"name":{"sType":"String","bRequired":true},"company_sid":{"sType":"String","bRequired":true},"description":{"sType":"String"},"project_id":{"sType":"Number"},"survey_id":{"sType":"Number","bRequired":true,"hOptions":{"1":"Thoughtronix Full Survey","2":"Thoughtronix Aflac Survey","3":"Thoughtronix Short Survey"}},"csv_map":{"sType":"String","sSample":"{}","sDescription":"CSV field-to-class-property map."},"percent_complete":{"sType":"Number","sDescription":"Number of surveys that are completely finished."}}
                ,hApi:{
                    save:function(hQuery,hData,hExtras,callback){
                        helpers.post({sPath:'/survey/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                    ,del:function(hQuery,hData,hExtras,callback){
                        helpers.delete({sPath:'/survey/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                    ,lookup:function(hQuery,hData,hExtras,callback){
                        helpers.get({sPath:'/survey/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                    ,responses:function(hQuery,hData,hExtras,callback){
                        helpers.get({sPath:'/survey/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                    ,addUser:function(hQuery,hData,hExtras,callback){
                        helpers.post({sPath:'/survey/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                    ,uploadCSV:function(hQuery,hData,hExtras,callback){
                        helpers.post({sPath:'/survey/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                }
            },SurveyResponse:{
                hProperties:{"sid":{"sType":"String","bPrimary":true,"nLength":"64","sSample":"YT8iHhr7YT8YT8"},"created":{"sType":"Timestamp","bOnCreate":true,"sSample":"1389625960"},"updated":{"sType":"Timestamp","bOnUpdate":true,"sSample":"1389625960"},"user_sid":{"sType":"String","sSample":"YT8iHhr7YT8YT8YT8iHhr7YT8YT8"},"survey_sid":{"sType":"String","sSample":"YT8iHhr7YT8YT8YT"},"project_id":{"sType":"Number"},"percent_complete":{"sType":"Number","sSample":"30"},"responses":{"sType":"String"}}
                ,hApi:{
                    del:function(hQuery,hData,hExtras,callback){
                        helpers.delete({sPath:'/surveyresponse/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                    ,save:function(hQuery,hData,hExtras,callback){
                        helpers.post({sPath:'/surveyresponse/'+hQuery.sid,hData:hData,hExtras:hExtras},function(err,res){
                            delete res.txid;
                            callback(err,res);
                        });
                    }
                }
            }
        }
        };
    })
    .factory('User',function(AppConfig){
        var User = {};
        for (var sEndpoint in AppConfig.hClasses.User.hApi) {
            User[sEndpoint] = AppConfig.hClasses.User.hApi[sEndpoint];
        }
        return User;
    }).factory('Company',function(AppConfig){
        var Company = {};
        for (var sEndpoint in AppConfig.hClasses.Company.hApi) {
            Company[sEndpoint] = AppConfig.hClasses.Company.hApi[sEndpoint];
        }
        return Company;
    }).factory('Survey',function(AppConfig){
        var Survey = {};
        for (var sEndpoint in AppConfig.hClasses.Survey.hApi) {
            Survey[sEndpoint] = AppConfig.hClasses.Survey.hApi[sEndpoint];
        }
        return Survey;
    }).factory('SurveyResponse',function(AppConfig){
        var SurveyResponse = {};
        for (var sEndpoint in AppConfig.hClasses.SurveyResponse.hApi) {
            SurveyResponse[sEndpoint] = AppConfig.hClasses.SurveyResponse.hApi[sEndpoint];
        }
        return SurveyResponse;
    })