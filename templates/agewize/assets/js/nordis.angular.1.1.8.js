angular.module('nordis', ['ngCookies','ui.bootstrap'])
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
    .config(function($compileProvider){
        $compileProvider.urlSanitizationWhitelist(/^\s*(https?|ftp|mailto|file|tel|itms-services):/);
    })
    .factory('helpers',function($rootScope,$http,$cookies,$location){
        var self = this;

        $rootScope.$watch(function() {
            return $location.path();
        }, function(newValue, oldValue) {
            if (newValue.match(/^\//))
                newValue = newValue.replace('/','');
            $rootScope.$broadcast('onForceNav',newValue);
        }, true);


        return {
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
            update:function(hOpts,hItem,aItems,bPrepend,cColl) {
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
            hideLoader:function(bShow){
                if (bShow)
                    this.emit('onUnload');
            },
            showLoader:function(bShow){
                if (bShow)
                    this.emit('onLoad');
            },
            loadPage:function(cColl,fnResultHandler,fnErrorHandler){
                var oSelf = this;
                var hData = (cColl.hData) ? cColl.hData : {};
                hData.nIndex = cColl.nIndex;
                hData.nSize = cColl.nSize;
                hData.nFirstID = cColl.nNextID;

                if (!cColl.hLoaded || !cColl.hLoaded[cColl.nIndex]) {
                    oSelf.callAPI({sPath:cColl.sPath,hData:hData,bShowLoader:cColl.bShowLoader,oObj:cColl},function(hResult){
                        cColl.nTotal = hResult.nTotal;
                        cColl.nIndex = hResult.nIndex;
                        cColl.nSize = hResult.nSize;
                        cColl.nCount = hResult.nCount;
                        cColl.nNextID = hResult.nNextID;
                        if (!cColl.hLoaded) cColl.hLoaded = {};
                        cColl.hLoaded[hResult.nIndex] = true;
                        if (hResult.aObjects) {
                            for (var i = 0; i < hResult.aObjects.length; i++) {
                                oSelf.update({nID:hResult.aObjects[i].nID},hResult.aObjects[i],cColl.aObjects,cColl.bPrepend);
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
                } else if (fnResultHandler)
                    fnResultHandler();
            },
            next:function(cColl,fnResultHandler,fnErrorHandler) {
                var oSelf = this;
                if (cColl && cColl.hLoaded && cColl.hLoaded[cColl.nIndex+1])
                    cColl.nIndex++;
                else if (cColl && cColl.nNextID) {
                    cColl.nIndex++;
                    oSelf.loadPage(cColl,fnResultHandler,fnErrorHandler);
                }
            },
            prev:function(cColl,fnResultHandler,fnErrorHandler) {
                var oSelf = this;
                if (cColl && cColl.nIndex > 0) {
                    if (!cColl.hLoaded || !cColl.hLoaded[cColl.nIndex-1]) {
                        cColl.nIndex--;
                        oSelf.loadPage(cColl,fnResultHandler,fnErrorHandler);
                    } else
                        cColl.nIndex--;
                }
            },
            refresh:function(cColl,fnCallback){
                var oSelf = this;
                cColl.hLoaded = {};
                cColl.aObjects = [];
                oSelf.loadPage(cColl,fnCallback);
            },
            callAPI:function(hOpts,fnCallback,fnErrorHandler){
                var oSelf = this;
                if (hOpts.sPath) {
                    if (!hOpts.hData) hOpts.hData = {};

                    oSelf.showLoader((hOpts && hOpts.bShowLoader));
                    if (hOpts.oObj) hOpts.oObj.bLoading = true;

                    console.log(hOpts.sPath);
                    console.log(hOpts.hData);
                    $http.post(hOpts.sPath,hOpts.hData)
                        .success(function(hResult,nStatus){
                            if (hOpts.oObj)
                                hOpts.oObj.bLoading = false;
                            oSelf.hideLoader((hOpts && hOpts.bShowLoader));
                            var hMsg;
                            if (hResult && hResult.aExceptions) {
                                if (fnErrorHandler) {
                                    fnErrorHandler(hResult,nStatus);
                                    return;
                                } else {
                                    for (var i = 0; i < hResult.aExceptions.length; i++) {
                                        var hExc = hResult.aExceptions[i];
                                        if (!hOpts.nExcType || hExc.nType != hOpts.nExcType) {
                                            if (!hMsg) hMsg = {sMsg:'',sDetail:''};
                                            hMsg.sDetail += hExc.sMessage;
                                            if(hExc.nType)
                                                hMsg.sData = 'Error Code: '+hExc.nType;
                                        }
                                    }
                                    if (hMsg)
                                        oSelf.alert(hMsg);
                                    else if (fnCallback)
                                        fnCallback(hResult,nStatus);
                                }
                            } else if (fnCallback)
                                fnCallback(hResult,nStatus);
                        })
                        .error(function(hResult,nStatus){
                            if (hOpts.oObj) hOpts.oObj.bLoading = false;
                            oSelf.hideLoader((hOpts && hOpts.bShowLoader));
                            if (fnErrorHandler)
                                fnErrorHandler(hResult,nStatus);
                            else
                                oSelf.alert({sMsg:hResult||'Request failed.',sDetail:window.sApi+hOpts.sPath,sData:JSON.stringify(hOpts.hData,null,4)})
                        });
                    if(!$rootScope.$$phase) {
                        $rootScope.$apply();    //AngularJS 1.1.4 fix
                    }
                }
            },
            getUrl:function(sUrl){
                if (!sUrl.match(/^http/))
                    return 'http://'+sUrl;
                else
                    return sUrl;
            },
            getDate:function(nTime) {
                return moment(nTime).calendar();
            },
            getFullDate:function(nTime,sTZ,bAllDay){
                if (!nTime)
                    return '';
                else {
                    var nHr = new Date(nTime).getHours();
                    var sTime = (bAllDay) ? moment(nTime).format('dddd, MMM Do') : moment(nTime).format('dddd, MMM Do, h:mm a');
                    if (!bAllDay && sTZ && window.sTZ && sTZ != window.sTZ)
                        return sTime + ' ('+window.sTZ+')';
                    else
                        return sTime;
                }
            },
            getTimeFromNow:function(nTime) {
                if (nTime)
                    return moment(nTime).fromNow();
                else
                    return '';
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
