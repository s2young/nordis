
angular.module('[[=hData.name]]', ['ngStorage'])
    .factory('[[=hData.name]]',function($rootScope,$http,$q,$localStorage,$cacheFactory){
        var self = this;
        if (!$localStorage.[[=hData.name]]) $localStorage.[[=hData.name]] = {};
        self.$db = $localStorage.[[=hData.name]];

        self.$cache = {};
        if (window.localforage) {
           self.$cache.db = localforage.config({name:'[[=hData.name]]'});
           console.log('localforage present!');
        } else {
            self.$cache.db = $cacheFactory('[[=hData.name]]',{capacity:20});
            console.log('localforage not present');
        }
        self.$cache.get = function(n){
            var q = $q.defer();
            if (window.localforage)
                self.$cache.db.getItem(n)
                    .then(function(res){
                        if (res)
                            q.resolve(JSON.parse(res));
                        else
                            q.resolve();
                    });
            else {
                q.resolve(self.$cache.db.get(n));
            }
            return q.promise;
        };
        self.$cache.set = function(n,v){
            if (window.localforage) {
                console.log('set in localforage',v);
                self.$cache.db.setItem(n,JSON.stringify(v));
            } else {
                console.log('set in cache',v);
                self.$cache.db.put(n,v)
            }
        };

        self.sHost = '';
        self.sSocketHost;
        self.bDebug;
        self.setHosts = function(sHost,sSocketHost,bDebug){
            if (sHost)
                self.sHost = sHost;
            if (sSocketHost) self.sSocketHost = sSocketHost;
            if (bDebug != undefined) self.bDebug = bDebug;
        };
        self.hHeaders = {};
        self.socket;
        var interval;var wait = 500;
        self.connectSocket = function(){
            if (self.sSocketHost) {
                if (!self.socket || self.socket.readyState != 1 ) {
                    self.socket = new SockJS(self.sSocketHost);
                    self.socket.onopen = function() {
                        $rootScope.$broadcast('onSocketOpen');
                        if (interval) clearTimeout(interval);
                    };
                    self.socket.onmessage = function(e) {
                        if (e.data)
                            $rootScope.$broadcast('onSocketMessage',e.data);
                    };
                    self.socket.onclose = function() {
                        $rootScope.$broadcast('onSocketClosed');
                        if (!self.socket.sever) {
                            interval = setTimeout(function(){
                                wait+=500;
                                if (wait <= 10000) {
                                    self.socket = null;
                                    self.connectSocket();
                                } else if (self.socket.readyState == 3) {
                                    $rootScope.$broadcast('onSocketDown');
                                    clearTimeout(interval);
                                    wait = 500;
                                }
                            },wait);
                        }
                    };
                } else
                    $rootScope.$broadcast('onSocketOpen');
            }
        };
        self.disconnectSocket = function(){
            if (self.socket) {
                self.socket.sever = true;
                self.socket.close();
            }
            $rootScope.$broadcast('onSocketClosed');
        };
        // This function finds the index of an item in a collection.
        self.findIndex = function(hOpts,aItems) {
            if (aItems) {
                if (aItems.aObjects) aItems = aItems.aObjects;
                for (var i = 0; i < aItems.length; i++) {
                    var bPass = true;
                    for (var sKey in hOpts) {
                        if (hOpts[sKey] != aItems[i][sKey])
                            bPass = false;
                    }
                    if (bPass) return i;
                }
            }
        };
        // Remove an item from a collection. Just pass in the object and the collection.
        self.remove = function(hItem,cColl,sKey) {
            sKey = (sKey) ? sKey : '[[=hData.sMostCommonPrimaryKey||'id']]';
            if (hItem && hItem[sKey] && cColl && cColl.aObjects) {
                var hLookup = {};hLookup[sKey] = hItem[sKey];
                var i = this.findIndex(hLookup,cColl.aObjects);
                if (i>=0) {
                    cColl.aObjects.splice(i,1);
                    cColl.nTotal--;
                    cColl.nCount--;
                    return i;
                }
            }
        };
        // Update a collection with an item, if the item already exists it is replaced.
        self.update = function(hItem,cColl,sKey,bAppend,bPrepend) {
            if (hItem) {
                if (hItem instanceof Array || hItem.aObjects) {
                    var aItems = hItem.aObjects || hItem;
                    for (var i = 0; i < aItems.length; i++) {
                        self.update(aItems[i],cColl,sKey,bAppend);
                    }
                    if (hItem.aObjects && cColl) {
                        cColl.sClass = hItem.sClass;
                        cColl.nTotal = hItem.nTotal;
                        cColl.nSize = hItem.nSize;
                        cColl.nCount = hItem.nCount;
                        cColl.nNextID = hItem.nNextID;
                        delete cColl.nFirstID;
                    }
                } else {
                    sKey = (sKey) ? sKey : '[[=hData.sMostCommonPrimaryKey||'id']]';
                    var i;
                    if (cColl) {
                        if (!cColl.aObjects) cColl.aObjects = [];
                        var hLookup = {};hLookup[sKey] = hItem[sKey];
                        if (!bAppend && !bPrepend) i = this.findIndex(hLookup,cColl.aObjects);
                        if (i>=0)
                            cColl.aObjects.splice(i,1,hItem);
                        else if (bPrepend)
                            cColl.aObjects.unshift(hItem);
                        else
                            cColl.aObjects.push(hItem);
                        if (cColl.aObjects.length > cColl.nCount) cColl.nCount = cColl.aObjects.length;
                        if (cColl.aObjects.length > cColl.nTotal) cColl.nTotal = cColl.aObjects.length;
                    }
                }
            }
        };
        // Emit an event from any controller to the root scope.
        self.emit = function(sEvent,Value,Value2,Value3) {
            $rootScope.$broadcast(sEvent,Value,Value2,Value3);
        };
        // I use this to display an alert modal with option buttons.
        self.confirmCommand = function(hOpts,fnCallback,fnNoCallback) {
            $rootScope.$broadcast('onConfirm',hOpts,fnCallback,fnNoCallback);
        };
        // Used to handle error messages and such. The event handler is in the header.dot partial.
        self.alert = function(hMsg,status) {
            if (hMsg)
                $rootScope.$broadcast('onAlert',hMsg,status);
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
        // Handles GET requests to the API.
        self.get = function(hOpts,fnCallback,fnErrorHandler,f){
            hOpts.m = 'GET';
            if (!hOpts.d) hOpts.d = {};
            if (hOpts.x)
                hOpts.d.hExtras = hOpts.x;

            var sCacheId = hOpts.p;
            if (hOpts.d) sCacheId += JSON.stringify(hOpts.d);
            console.log(sCacheId);
            self.$cache.get(sCacheId)
                .then(function(res){
                    if (res && !f) {
                        console.log('cached!',res);
                        fnCallback(res);
                    } else
                        self.callAPI(hOpts,function(result){
                            console.log('not cached');
                            self.$cache.set(sCacheId,result);
                            fnCallback(result);
                        },fnErrorHandler);
                });
        };
        // Handles POST requests to the API.
        self.post = function(hOpts,fnCallback,fnErrorHandler){
            hOpts.m = 'POST';
            if (!hOpts.d) hOpts.d = {};
            if (hOpts.x)
                hOpts.d.hExtras = hOpts.x;
            self.callAPI(hOpts,fnCallback,fnErrorHandler);
        };
        // Handles DELETE requests to the API.
        self.delete = function(hOpts,fnCallback,fnErrorHandler){
            if (!hOpts.d) hOpts.d = {};
            hOpts.p += '?'
            for (var sItem in hOpts.d) {
                switch (sItem) {
                    case 'hExtras':
                        hOpts.p += serialize(hOpts.d[sItem],sItem)+'&';
                        break;
                    default:
                        hOpts.p += sItem+'='+hOpts.d[sItem]+'&';
                        break;
                }
            }
            hOpts.m = 'DELETE';
            this.callAPI(hOpts,fnCallback,fnErrorHandler);
        };
        // This method is shared by POST, GET, and DELETE methods.
        self.callAPI = function(hOpts,fnCallback,fnErrorHandler){
            var self = this;
            var m = (hOpts.m && hOpts.m.match(/(GET|POST|DELETE)/)) ? hOpts.m.toLowerCase() : 'get';
            if (hOpts.p) {
                hOpts.d.t = new Date().getTime();
                $http({method:m,url:self.sHost+hOpts.p,params:(m=='get')?hOpts.d:{t:hOpts.d.t},data:(m=='post')?hOpts.d:null,headers:self.hHeaders})
                    .success(function(hResult,nStatus){
                        if (hResult && hResult.sException) {
                            if (fnErrorHandler)
                                fnErrorHandler(hResult);
                            else
                                self.alert(hResult);
                        } else if (fnCallback)
                            fnCallback(hResult,nStatus);
                    })
                    .error(function(data, status, headers, config){
                        if (!data && status == 404)
                            self.alert('Request failed. Check your connection or try again later.');
                        else if (fnErrorHandler)
                            fnErrorHandler(data,status);
                        else if (data)
                            self.alert(data);
                    });
            }
        };
        self.promise = function(p,m,d,x,f){
            var deferred = $q.defer();
            self[m]({p:p,d:d,x:x},function(res){
                delete res.txid;
                deferred.resolve(res);
            },deferred.reject,f);

            return deferred.promise;
        };
        [[for (var sClass in hData.hApiCalls) {]]
        self.[[=sClass]] = {
            sKey:'[[=hData.hKeys[sClass]||'']]'[[~hData.hApiCalls[sClass] :hCall:nIndex]]
            ,[[=hCall.sAlias]]:function(q,d,x,f){[[ hData.sKey = (hCall.sEndpoint.match(/\{(.*)\}/)) ? '\''+hCall.sEndpoint.match(/\{(.*)\}/)[1]+'\'' : null; ]]
                return self.promise('[[=hCall.sEndpoint.replace('{','\'+q.').replace('}','+\'')]]','[[=hCall.sMethod]]',d,x,f);
            }[[~]]
        };[[}]]
        return self;
    })
