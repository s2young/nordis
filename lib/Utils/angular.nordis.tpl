window.sNordisHost = window.sNordisHost||'[[=hData.sNordisHost||""]]';

angular.module('nordis', [])
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
    .directive('modalDialog', function() {
        return {
            restrict: 'E',
            scope: {
                show: '='
            },
            replace: true, // Replace with the template below
            transclude: true, // we want to insert custom content inside the directive
            link: function(scope, element, attrs) {
                scope.dialogStyle = {};

                if (attrs.width)
                    scope.dialogStyle.width = attrs.width;
                if (attrs.height)
                    scope.dialogStyle.height = attrs.height;
                if (attrs.zindex)
                    scope.dialogStyle['z-index'] = attrs.zindex;
                if (attrs.bgcolor)
                    scope.dialogStyle['background-color'] = attrs.bgcolor;

                scope.hideModal = function() {
                    scope.show = false;
                };
                scope.$on('onClose',function(e){
                    scope.show = false;
                })
            },
            template: '<div class="ng-modal" ng-show="show"><div class="ng-modal-overlay" ng-click="hideModal()"></div><div class="ng-modal-dialog" ng-style="dialogStyle"><div class="ng-modal-dialog-content" ng-transclude></div></div></div>'
        };
    })
    .directive('nordisOnload',function(){
        // This allows the display of an element with the .angular.js file emits an onLoad event. for use with spinners, loaders, progress-bars, etc.
        return {
            restrict: 'A'
            ,replace: false
            ,transclude: true
            ,link: function(scope, element, attrs) {

                switch (attrs.nordisOnload) {
                    case 'show':
                        angular.element(element).attr('style', 'visibility:hidden;');
                        scope.$on('onLoad',function(e){
                            angular.element(element).attr('style', 'visibility:visible;');
                        });
                        scope.$on('onUnload',function(e){
                            angular.element(element).attr('style', 'visibility:hidden;');
                        });
                        break;
                    case 'hide':
                        angular.element(element).attr('style', 'visibility:visible;');
                        scope.$on('onLoad',function(e){
                            angular.element(element).attr('style', 'visibility:hidden;');
                        });
                        scope.$on('onUnload',function(e){
                            angular.element(element).attr('style', 'visibility:visible;');
                        });
                        break;
                }
            },
            template:'<span><span ng-transclude></span></span>'
        }
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

        self.hSecurity = {};
        self.setSecurity = function(hSecurity){
            if (hSecurity)
                self.hSecurity = hSecurity;
        };
        self.getSecurity = function(hData) {
            if (self.hSecurity)
                for (var sProp in self.hSecurity) {
                    hData[sProp] = self.hSecurity[sProp];
                }
        };

        // This function finds the index of an item in a collection.
        self.findIndex = function(hOpts,aItems) {
                if (aItems)
                    for (var i = 0; i < aItems.length; i++) {
                        var bPass = true;
                        for (var sKey in hOpts) {
                            if (hOpts[sKey] != aItems[i][sKey])
                                bPass = false;
                        }
                        if (bPass) return i;
                    }
            };
        // Remove an item from a collection. Just pass in the object and the collection.
        self.remove = function(hItem,cColl,sKey) {
                sKey = (sKey) ? sKey : 'id';
                if (hItem && hItem[sKey] && cColl && cColl.aObjects) {
                    var hLookup = {};hLookup[sKey] = hItem[sKey];
                    var i = this.findIndex(hLookup,cColl.aObjects);
                    if (i>=0) {
                        cColl.aObjects.splice(i,1);
                        cColl.nTotal--;
                        cColl.nCount--;
                    }
                }
            };
        // Update a collection with an item, if the item already exists it is replaced.
        self.update = function(hItem,cColl,sKey) {
                sKey = (sKey) ? sKey : 'id';
                var i;
                if (cColl) {
                    if (!cColl.aObjects) cColl.aObjects = [];
                    var hLookup = {};hLookup[sKey] = hItem[sKey];
                    i = this.findIndex(hLookup,cColl.aObjects);
                    if (i>=0)
                        cColl.aObjects.splice(i,1,hItem);
                    else
                        cColl.aObjects.push(hItem);
                    if (cColl.aObjects.length > cColl.nCount) cColl.nCount = cColl.aObjects.length;
                    if (cColl.aObjects.length > cColl.nTotal) cColl.nTotal = cColl.aObjects.length;
                }
                return i;
            };
        // Emit an event from any controller to the root scope.
        self.emit = function(sEvent,Value,Value2,Value3) {
                $rootScope.$broadcast(sEvent,Value,Value2,Value3);
            };
        // I use this to display an alert modal with option buttons.
        self.confirmCommand = function(hOpts,fnCallback,fnNoCallback) {
                this.emit('onConfirm',hOpts,fnCallback,fnNoCallback);
            };
        // Used to handle error messages and such. The event handler is in the header.dot partial.
        self.alert = function(hMsg) {
                this.emit('onAlert',hMsg);
            };
        // Grab items from the query string.
        self.query = function(name) {
                name = name.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]");
                var regexS = "[\\?&]" + name + "=([^&#]*)";
                var regex = new RegExp(regexS);
                var results = regex.exec(window.location.search);
                if(results == null) {
                    return "";
                } else
                    return decodeURIComponent(results[1].replace(/\+/g, " "));
            };
        // Load a collection via api call.
        self.loadPage = function(cColl,fnResultHandler,fnErrorHandler,sKey){
                var self = this;
                var hData = (cColl.hData) ? cColl.hData : {};
                if (cColl.hExtras)
                    hData.hExtras = cColl.hExtras;
                else if (cColl.nSize || cColl.nFirstID || cColl.sFirstID || cColl.nMin || cColl.nMax)
                    hData.hExtras = {};

                if (cColl.nSize) hData.hExtras.nSize = cColl.nSize;
                if (cColl.nFirstID) hData.hExtras.sFirstID = cColl.sFirstID;
                if (cColl.sFirstID) hData.hExtras.sFirstID = cColl.sFirstID;
                if (cColl.nMin) hData.hExtras.nMin = cColl.nMin;
                if (cColl.nMax) hData.hExtras.nMax = cColl.nMax;
                if (cColl.sTerm) hData.sTerm = cColl.sTerm;

                self.get({sPath:cColl.sPath,hData:hData,bShowLoader:cColl.bShowLoader,oObj:cColl},function(hResult){
                    cColl.nTotal = hResult.nTotal;
                    cColl.nSize = hResult.nSize;
                    cColl.nCount = hResult.nCount;
                    cColl.nNextID = hResult.sNextID||hResult.nNextID;
                    cColl.sNextID = hResult.sNextID;

                    if (!cColl.aObjects) cColl.aObjects = [];
                    delete hResult.nFirstID;
                    delete hResult.sFirstID;
                    delete hResult.nMin;
                    delete hResult.nMax;

                    if (hResult.aObjects) {
                        for (var i = 0; i < hResult.aObjects.length; i++) {
                            self.update(hResult.aObjects[i],cColl,sKey);
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
            };

        self.next = function(cColl,fnResultHandler,fnErrorHandler,sKey) {
                var self = this;
                if ((cColl.nNextID || cColl.sNextID || cColl.nMin) && !cColl.bLoading) {
                    if (cColl.nNextID || cColl.sNextID) cColl.sFirstID = cColl.nNextID || cColl.sNextID;
                    delete (cColl.nNextID);
                    delete (cColl.sNextID);
                    self.loadPage(cColl,fnResultHandler,fnErrorHandler,sKey);
                }
            }
        // Handles GET requests to the API.
        self.get = function(hOpts,fnCallback,fnErrorHandler){
                hOpts.sMethod = 'GET';
                if (!hOpts.hData) hOpts.hData = {};
                if (hOpts.hExtras)
                    hOpts.hData.hExtras = hOpts.hExtras;

                self.getSecurity(hOpts.hData);
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

                    hOpts.sPath += '?';
                    for (var sItem in hOpts.hData) {
                        switch (sItem) {
                            case 'hExtras':
                                hOpts.sPath += serialize(hOpts.hData[sItem],sItem)+'&';
                                break;
                            default:
                                hOpts.sPath += sItem+'='+hOpts.hData[sItem]+'&';
                                break;
                        }
                    }
                }
                this.callAPI(hOpts,fnCallback,fnErrorHandler);
            };
        // Handles POST requests to the API.
        self.post = function(hOpts,fnCallback,fnErrorHandler){
                hOpts.sMethod = 'POST';
                if (!hOpts.hData) hOpts.hData = {};
                self.getSecurity(hOpts.hData);
                if (hOpts.hExtras)
                    hOpts.hData.hExtras = hOpts.hExtras;

                this.callAPI(hOpts,fnCallback,fnErrorHandler);
            };
        // Handles DELETE requests to the API.
        self.delete = function(hOpts,fnCallback,fnErrorHandler){
                if (!hOpts.hData) hOpts.hData = {};
                self.getSecurity(hOpts.hData);

                if (hOpts.hData) {
                    hOpts.sPath += '?'
                    for (var sItem in hOpts.hData) {
                        switch (sItem) {
                            case 'hExtras':
                                hOpts.sPath += serialize(hOpts.hData[sItem],sItem)+'&';
                                break;
                            default:
                                hOpts.sPath += sItem+'='+hOpts.hData[sItem]+'&';
                                break;

                        }
                    }
                }
                hOpts.sMethod = 'DELETE';
                this.callAPI(hOpts,fnCallback,fnErrorHandler);
            };
        // This method is shared by POST, GET, and DELETE methods.
        self.callAPI = function(hOpts,fnCallback,fnErrorHandler){
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
                        .error(function(data, status, headers, config){
                            if (hOpts.oObj) hOpts.oObj.bLoading = false;
                            self.emit('onUnload');

                            if (fnErrorHandler)
                                fnErrorHandler(data,status);
                            else
                                self.alert(data);
                        });
                }
            };
        return self;
    })
    .filter('startFrom', function() {
        return function(input, start) {
            if (input) {
                start = +start; //parse to int
                return input.slice(start);
            } else
                return 0;
        }
    })
    .factory('AppConfig',function(helpers){
        return {hClasses:{
                [[for (var sClass in hData.hClasses) {]][[? hData.sComma ]][[=hData.sComma]][[?]][[=sClass]]:{
                    hProperties:[[=JSON.stringify(hData.hClasses[sClass])]]
                    ,sKey:"[[=hData.hKeys[sClass] ]]"
                    ,hApi:{[[? hData.hApiCalls[sClass] ]][[~hData.hApiCalls[sClass] :hCall:nIndex]]
                        [[? nIndex ]],[[?]][[=hCall.sAlias]]:function(hQuery,hData,hExtras,callback){
                            if (hExtras instanceof Function) callback = hExtras;
                            else if (hData instanceof Function) callback = hData;
                            [[ hData.sPath = "'"+hCall.sEndpoint.replace('{','\'+hQuery.').replace('}','+\'')+"'"; ]]
                             helpers.[[=hCall.sMethod]]({sPath:[[=hData.sPath]],hData:hData,hExtras:hExtras},function(res){
                                 delete res.txid;
                                 if (callback) callback(null,res);
                             },callback);
                         }[[~]]
                    [[?]]}
                }[[hData.sComma=',';]][[}]]
            }
        };
    })
[[for (var sClass in hData.hApiCalls) {]]
    .factory('[[=sClass]]',function(AppConfig){
        var [[=sClass]] = {sKey:AppConfig.hClasses.[[=sClass]].sKey,hProperties:AppConfig.hClasses.[[=sClass]].hProperties};
        for (var sEndpoint in AppConfig.hClasses.[[=sClass]].hApi) {
            [[=sClass]][sEndpoint] = AppConfig.hClasses.[[=sClass]].hApi[sEndpoint];
        }
        return [[=sClass]];
    })[[}]]