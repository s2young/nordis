if (!window.aAngularMods)
    window.aAngularMods = ['ui.bootstrap'];

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
//    .config(function($compileProvider){
//        $compileProvider.urlSanitizationWhitelist(/^\s*(https?|ftp|mailto|file|tel|itms-services):/);
//    })
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
            fadeIn:function($element){
                angular.element($element).addClass('in').removeClass('out');
            },
            findItem:function(hOpts,aItems) {
                var i = this.findIndex(hOpts,aItems);
                if (i >= 0)
                    return aItems[i];
                else
                    return;
            },
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
            remove:function(hItem,cColl) {
                if (hItem && hItem.id && cColl && cColl.aObjects) {
                    hItem.bRemoved = true;
                    this.update({id:hItem.id},hItem,cColl.aObjects,null,cColl);
                }
            }
            ,update:function(hOpts,hItem,aItems,bPrepend,cColl) {
                if (aItems) {
                    var i = this.findIndex(hOpts,aItems);
                    if (i >= 0) {
                        if (hItem.bRemoved) {
                            aItems.splice(i,1);
                            if (cColl)
                                cColl.nTotal--;
                        } else
                            aItems.splice(i,1,hItem);

                    } else if (!hItem.bRemoved) {
                        if (bPrepend) {
                            aItems.splice(0,0,hItem);
                        } else {
                            aItems.push(hItem);
                        }
                        if (cColl)
                            cColl.nTotal++;
                        return true;
                    }
                }
                return;
            },
            emit:function(sEvent,Value,Value2,Value3) {
                $rootScope.$broadcast(sEvent,Value,Value2,Value3);
            },
            onNav:function(sCtrl,element,fnCallback){
                if (sCtrl && sCtrl+'Ctrl' == element.attr('ng-controller')) {
                    if (!$(element).is(':visible')) {
                        $(element).fadeIn();
                        if (fnCallback) fnCallback();
                    }
                } else
                    $(element).hide();

            },
            confirmCommand: function(hOpts,fnCallback,fnNoCallback) {
                this.emit('onConfirm',hOpts,fnCallback,fnNoCallback);
            },
            alert:function(hMsg) {
                this.emit('onAlert',hMsg);
            },
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
                            self.update({id:hResult.aObjects[i].id},hResult.aObjects[i],cColl.aObjects,cColl.bPrepend);
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
            next:function(cColl,fnResultHandler,fnErrorHandler) {
                var self = this;

                if ((cColl.nNextID || cColl.nMin) && !cColl.bLoading) {
                    if (cColl.nNextID) cColl.nFirstID = cColl.nNextID;
                    self.loadPage(cColl,fnResultHandler,fnErrorHandler);
                }
            },
            refresh:function(cColl,fnCallback){
                var self = this;
                cColl.aObjects = [];
                delete cColl.nFirstID;
                delete cColl.nNextID;
                self.loadPage(cColl,fnCallback);
            },
            search:function(cColl,fnCallback){
                var self = this;
                if (cColl && cColl.sPath && (cColl.sTerm || cColl.sLastTerm)) {
                    if (cColl.sLastTerm != cColl.sTerm) {
                        cColl.nTotal = 0;
                        cColl.nCount = 0;
                        cColl.aObjects = [];
                    }
                    if (cColl.sTerm)
                        this.get({sPath:cColl.sPath,hData:{sClass:cColl.sClass,sTerm:cColl.sTerm,nSize:cColl.nSize,hExtras:cColl.hExtras},oObj:cColl,bShowLoader:cColl.bShowLoader},function(hResult){
                            if (hResult.aObjects.length) {
                                cColl.nNextID = hResult.nNextID;
                                cColl.nTotal = hResult.nTotal;
                                cColl.sClass = hResult.sClass;
                                for (var n = 0; n < hResult.aObjects.length; n++) {
                                    self.update({id:hResult.aObjects[n].id},hResult.aObjects[n],cColl.aObjects);
                                }
                            }
                            cColl.sLastTerm = cColl.sTerm;
                            if (!cColl.bKeepTerm) cColl.sTerm = '';
                            if (fnCallback)
                                fnCallback(hResult);
                        });
                }
            }
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
                            case 'nSize':case 'nFirstID':case 'nMin':case 'sTerm':
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
            ,post:function(hOpts,fnCallback,fnErrorHandler){
                hOpts.sMethod = 'POST';
                if (hOpts.hExtras) {
                    if (!hOpts.hData) hOpts.hData = {};
                    hOpts.hData.hExtras = hOpts.hExtras;
                }
                this.callAPI(hOpts,fnCallback,fnErrorHandler);
            }
            ,delete:function(hOpts,fnCallback,fnErrorHandler){
                hOpts.sMethod = 'DELETE';
                this.callAPI(hOpts,fnCallback,fnErrorHandler);
            }
            ,callAPI:function(hOpts,fnCallback,fnErrorHandler){
                var self = this;
                var sMethod = (hOpts.sMethod && hOpts.sMethod.match(/(GET|POST|DELETE)/)) ? hOpts.sMethod : 'GET';
                if (hOpts.sPath) {
                    if (!hOpts.hData) hOpts.hData = {};

                    self.emit('onLoad');
                    if (hOpts.oObj) hOpts.oObj.bLoading = true;

                    console.log(sMethod+': '+hOpts.sPath);
                    $http[sMethod.toLowerCase()](hOpts.sPath,hOpts.hData)
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
            },
            isValidEmail:function(sEmail) {
                var re = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
                return re.test(sEmail);
            },
            sFocus:($location.path()) ? $location.path().substring(1) : ''
            //sFocus:(window.location.search && window.location.search.match(/\?([^&#]*)/)) ? self.sFocus = window.location.search.match(/\?([^&#]*)/)[1] : ''
        }
    })
    .filter('startFrom', function() {
        return function(input, start) {
            start = +start; //parse to int
            return input.slice(start);
        }
    });
//noinspection JSUndeclaredVariable
//!function(d,s,id){var js,fjs=d.getElementsByTagName(s)[0];if(!d.getElementById(id)){js=d.createElement(s);js.id=id;js.src="https://platform.twitter.com/widgets.js";fjs.parentNode.insertBefore(js,fjs);}}(document,"script","twitter-wjs");
