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

        if (window.nFacebookID) {
            // Additional JS functions here
            window.fbAsyncInit = function() {
                FB.init({
                    appId      : window.nFacebookID,
                    channelUrl : '//'+window.sDomain+'/channel.html',
                    status     : true,
                    cookie     : true,
                    xfbml      : true
                });
            };
            (function(d){
                var js, id = 'facebook-jssdk', ref = d.getElementsByTagName('script')[0];
                if (d.getElementById(id)) {return;}
                js = d.createElement('script'); js.id = id; js.async = true;
                js.src = "//connect.facebook.net/en_US/all.js";
                ref.parentNode.insertBefore(js, ref);
            }(document));
        }

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
                if (sEvent == 'onObjectRemoved') {
                    $("body").fadeOut();
                    window.location = window.sUrl+'s';
                }
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
                if (window.fnConfirmCommandHandler)
                    window.fnConfirmCommandHandler(hOpts,fnCallback,fnNoCallback);
                else
                    this.emit('onConfirm',hOpts,fnCallback,fnNoCallback);
            },
            alert:function(hMsg) {
                if (window.fnAlertHandler)
                    window.fnAlertHandler(hMsg);
                else
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
            search:function(cColl,nIndex,fnCallback){
                var self = this;
                if (cColl && cColl.sPath && (cColl.sTerm || cColl.sLastTerm)) {
                    cColl.nIndex = (cColl.nIndex) ? cColl.nIndex+nIndex : nIndex;
                    if (nIndex && !cColl.sTerm && cColl.sLastTerm)
                        cColl.sTerm = cColl.sLastTerm;

                    if (cColl.sLastTerm != cColl.sTerm) {
                        cColl.nTotal = 0;
                        cColl.nCount = 0;
                        cColl.aObjects = [];
                    }

                    if (cColl.sTerm)
                        this.callAPI({sPath:cColl.sPath,hData:{sClass:cColl.sClass,sTerm:cColl.sTerm,nSize:cColl.nSize,nIndex:cColl.nIndex},oObj:cColl,bShowLoader:cColl.bShowLoader},function(aResults){
                            if (aResults.length) {
                                for (var i=0; i < aResults.length; i++) {
                                    if (aResults[i].aObjects.length) {
                                        cColl.nNextID = aResults[i].nNextID;
                                        cColl.nTotal = aResults[i].nTotal;
                                        for (var n = 0; n < aResults[i].aObjects.length; n++) {
                                            self.update({nID:aResults[i].aObjects[n].nID},aResults[i].aObjects[n],cColl.aObjects);
                                        }
                                    }
                                }
                            }

                            cColl.sLastTerm = cColl.sTerm;
                            if (!cColl.bKeepTerm)
                                cColl.sTerm = '';

                            if (fnCallback)
                                fnCallback();
                        });
                }
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
            loadFeatures:function(cSource,cDest){
                cDest.nTotal = 0;
                cDest.nCount = 0;
                cDest.aObjects = [];
                var oSelf = this;
                var nNow = new Date().getTime();
                for (var i = 0; i < cSource.aObjects.length; i++){
                    var oItem = cSource.aObjects[i];
                    if (oItem.nFeatureSortOrder < 4
                        && (
                        (oItem.nFeatureStart <= nNow && (oItem.nFeatureEnd == 0 || oItem.nFeatureEnd > nNow))
                            || (oItem.nFeatureEnd > nNow && (oItem.nFeatureStart == 0 || oItem.nFeatureStart <= nNow))
                        )
                        )
                        oSelf.update({nID:oItem.nID},oItem,cDest.aObjects,null,cDest);
                }
                if (cDest.aObjects.length < 3) {
                    for (var i = 0; i < cSource.aObjects.length; i++){
                        if (cSource.aObjects[i].nFeatureSortOrder >= 4) {
                            oSelf.update({nID:cSource.aObjects[i].nID},cSource.aObjects[i],cDest.aObjects,null,cDest);
                            if (cDest.aObjects.length >= 3)
                                break;
                        }
                    }
                }
            },
            callAPI:function(hOpts,fnCallback,fnErrorHandler){
                var oSelf = this;
                if (hOpts.sPath) {
                    if (!hOpts.hData) hOpts.hData = {};
                    hOpts.hData.sToken = $cookies[window.sCID]||window.sConsumer;
                    hOpts.hData.sToken = hOpts.hData.sToken.replace(/"/g,'');

                    console.log(hOpts.hData.sToken);

                    if (!hOpts.sPath.match(/^\/v(1|2)/))
                        hOpts.sPath = '/v1'+hOpts.sPath;
                    oSelf.showLoader((hOpts && hOpts.bShowLoader));
                    if (hOpts.oObj) hOpts.oObj.bLoading = true;

//                    console.log(window.sApi+hOpts.sPath);
//                    console.log(hOpts.hData);
                    $http.post(window.sApi+hOpts.sPath,hOpts.hData)
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
            tweet:function(hOpts,fnCallback,fnErrorHandler){
                var oSelf = this;
                oSelf.showLoader();
                $http.post(hOpts.sPath,hOpts.hData)
                    .success(function(hResult,nStatus){
                        oSelf.hideLoader();
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
                        oSelf.hideLoader();
                        if (fnErrorHandler)
                            fnErrorHandler(hResult,nStatus);
                        else
                            oSelf.alert({sMsg:hResult||'Request failed.',sDetail:'',sData:JSON.stringify(hOpts.hData,null,4)})
                    });
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
            getDescription:function(oObj){
                if (oObj && oObj.sDetails && oObj.sDetails.length > 150)
                    return oObj.sDetails.substring(0,150) + ' ...';
                else if (oObj && oObj.sDetails)
                    return oObj.sDetails;
                else
                    return '';
            },
            getAddress:function(oPlace){
                var sResult = '';
                if (oPlace) {
                    if (oPlace.sTitle)
                        sResult += oPlace.sTitle;
                    if (oPlace.sAddress)
                        sResult += '\n'+oPlace.sAddress;
                    if (oPlace.sCity)
                        sResult += '\n'+oPlace.sCity;
                    if (oPlace.sState)
                        sResult += ', '+oPlace.sState;
                    if (oPlace.sPhone)
                        sResult += '\n'+oPlace.sPhone;
                }
                return sResult;
            },
            getHtml:function(sValue){
                if (sValue) {
                    var re = new RegExp(/\b(http[s]?:\/\/[^\s"']*)/g);
                    var aMatches = sValue.match(re);
                    if (aMatches && aMatches.length)
                        for (var i = 0; i < aMatches.length; i++) {
                            sValue = sValue.replace(aMatches[i],'<a href="'+aMatches[i]+'">'+aMatches[i]+'</a>');
                        }
                    sValue = sValue.replace(/\n/g,'<br/>');
                }
                return sValue;
            },
            getTimeFromNow:function(nTime) {
                if (nTime)
                    return moment(nTime).fromNow();
                else
                    return '';
            },
            launch:function(oObj){

                var sLocation;
                if (oObj.sGroupID)
                    sLocation = '/group/'+oObj.sGroupID;
                else if (oObj.sEventID)
                    sLocation = '/event/'+oObj.sEventID;
                else if (oObj.sNewsID)
                    sLocation = '/news/'+oObj.sNewsID;
                else if (oObj.sPageID)
                    sLocation = '/page/'+oObj.sPageID;

                if (sLocation) {
                    this.showLoader(true);
                    window.location = sLocation;
                }
            },
            getSrc:function(oObj,sProp){
                var sImage;
                if (oObj && oObj.hImage && oObj.hImage[sProp]) {
                    sImage = oObj.hImage[sProp].replace('http:',window.location.protocol);
                } else if (oObj && oObj[sProp]) {
                    sImage = oObj[sProp].replace('http:',window.location.protocol);
                } else if (oObj && oObj.sImage) {
                    sImage = oObj.sImage.replace('http:',window.location.protocol);
                } else if (oObj && oObj.nUserID && sProp == 'sImage')
                    sImage = window.location.protocol+'//'+window.sDomain+'/sUserAvatar15';
                return sImage;
            },
            getMediaIcon:function(nMedium){
                var sResult;
                switch (nMedium) {
                    case 1:
                        sResult = '/shared/img/glyph/icons/icons-gray/54-lock@2x.png';
                        break;
                    case 2:
                        sResult = 'email_32.png';
                        break;
                    case 3:
                        sResult = 'google_talk_32.png';
                        break;
                    case 4:
                        sResult = 'facebook_32.png';
                        break;
                    case 5:
                        sResult = 'twitter_32.png';
                        break;
                    case 6:
                        sResult = 'apple_32.png';
                        break;
                    case 7:
                        sResult = 'google_buzz_32.png';
                        break;
                    case 13:
                        sResult = 'apploogle_32.png';
                        break;
                    case 10:
                        sResult = '/shared/img/glyph/icons/icons-gray/21-skull@2x.png';
                        break;
                }
                if (sResult)
                    return '/shared/img/icons/circular/'+sResult;
                else
                    return '';
            },
            loginFB:function(){
                var oSelf = this;
                var register = function(auth){
                    FB.api('/me', function(user) {
                        oSelf.callAPI({sPath:'/user/register.json',hData:{nFacebookID:auth.userID,sFacebookToken:auth.accessToken,sName:user.name,sEmail:user.email},nExcType:415.5},function(hResult){
                            if (hResult.aEvents)
                                $rootScope.$broadcast(hResult.aEvents[0],hResult);
                        },function(hResult){
                            if (hResult.aExceptions)
                                $rootScope.$broadcast('onAlert',{sMsg:'Oops',sDetail:hResult.aExceptions[0].sMessage});
                        });
                    });
                };
                FB.getLoginStatus(function(response) {
                    if (response.status === 'connected' && response.authResponse.email)
                        register(response.authResponse);
                    else
                        FB.login(function(response) {
                            if (response.authResponse)
                                register(response.authResponse);
                        },{scope: 'email'});
                });
            },
            toggle:function($event,fnAfter){
                var divContent;
                if ($($event.currentTarget).hasClass('toggle')) {
                    divContent = $($event.currentTarget).parent().find('.grid-content');
                } else {
                    divContent = $($event.currentTarget).parent().parent().find('.grid-content');
                }

                if (divContent.hasClass('hide') || divContent.hasClass('hidden-phone')) {
                    divContent.removeClass('hide');
                    divContent.removeClass('hidden-phone');
                    if (fnAfter)
                        fnAfter();
                } else
                    divContent.addClass('hide');

            },
            isValidEmail:function(sEmail) {
                var re = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
                return re.test(sEmail);
            },
            getClass:function(oObj){
                for (var sName in oObj) {
                    var aMatches = sName.match(/^n(.+)ID$/);
                    if (aMatches && oObj[sName])
                        return aMatches[1];
                }
                for (var sName in oObj) {
                    var aMatches = sName.match(/^s(.+)ID$/);
                    if (aMatches && oObj[sName])
                        return aMatches[1];
                }
                if (oObj.nUserID && oObj.sAppTitle != undefined)
                    return 'User';
                return '';
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
