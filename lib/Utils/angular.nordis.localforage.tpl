angular.module('[[=hData.name]]', ['LocalForageModule'])
    .factory('[[=hData.name]]',function($rootScope,$http,$q,$localForage){
        var self = this;

        self.sHost = '';
        self.sSocketHost;
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
                        if (cColl.aObjects.length > cColl.nTotal) cColl.nTotal = cColl.aObjects.length;
                    }
                }
            }
        };
        // Handles GET requests to the API.
        self.get = function(hOpts,fnCallback,fnErrorHandler,nLastUpdate){
            hOpts.sMethod = 'GET';
            if (!hOpts.hData) hOpts.hData = {};
            if (hOpts.hExtras)
                hOpts.hData.hExtras = hOpts.hExtras;

            var sCacheId = hOpts.sPath;
            if (hOpts.hData) sCacheId += JSON.stringify(hOpts.hData);
            if (hOpts.hExtras) sCacheId += JSON.stringify(hOpts.hExtras);
            $localForage.getItem(sCacheId)
                .then(function(cache) {
                    console.log('nLastUpdate:'+nLastUpdate);
                      if (cache && (!nLastUpdate || cache.time <= nLastUpdate)) {
                          console.log('cached!');
                          fnCallback(cache.result);
                      } else {
                          self.callAPI(hOpts,function(result){
                              $localForage.setItem(sCacheId,{time:new Date().getTime(),result:result})
                              fnCallback(result);
                          },fnErrorHandler);
                      }
                  },fnErrorHandler);

        };
        // Handles POST requests to the API.
        self.post = function(hOpts,fnCallback,fnErrorHandler){
            hOpts.sMethod = 'POST';
            if (!hOpts.hData) hOpts.hData = {};
            if (hOpts.hExtras)
                hOpts.hData.hExtras = hOpts.hExtras;
            this.callAPI(hOpts,fnCallback,fnErrorHandler);
        };
        // Handles DELETE requests to the API.
        self.delete = function(hOpts,fnCallback,fnErrorHandler){
            if (!hOpts.hData) hOpts.hData = {};
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
            hOpts.sMethod = 'DELETE';
            this.callAPI(hOpts,fnCallback,fnErrorHandler);
        };
        // This method is shared by POST, GET, and DELETE methods.
        self.callAPI = function(hOpts,fnCallback,fnErrorHandler){
            var self = this;
            var sMethod = (hOpts.sMethod && hOpts.sMethod.match(/(GET|POST|DELETE)/)) ? hOpts.sMethod.toLowerCase() : 'get';
            if (hOpts.sPath) {
                $http({method:sMethod,url:self.sHost+hOpts.sPath,params:(sMethod=='get')?hOpts.hData:null,data:(sMethod=='post')?hOpts.hData:null,headers:self.hHeaders})
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
        self.promise = function(sPath,sMethod,hData,hExtras,hCache){
            var deferred = $q.defer();
            self[sMethod]({sPath:sPath,hData:hData,hExtras:hExtras},function(res){
                delete res.txid;
                deferred.resolve(res);
            },deferred.reject,hCache);

            return deferred.promise;
        };
        [[for (var sClass in hData.hApiCalls) {]]
        self.[[=sClass]] = {
            sKey:'[[=hData.hKeys[sClass]||'']]'[[~hData.hApiCalls[sClass] :hCall:nIndex]]
            ,[[=hCall.sAlias]]:function(hQuery,hData,hExtras,nLastUpdate){[[ hData.sKey = (hCall.sEndpoint.match(/\{(.*)\}/)) ? '\''+hCall.sEndpoint.match(/\{(.*)\}/)[1]+'\'' : null; ]]
                console.log('nLastUpdate 2:'+nLastUpdate);
                return self.promise('[[=hCall.sEndpoint.replace('{','\'+hQuery.').replace('}','+\'')]]','[[=hCall.sMethod]]',hData,hExtras,nLastUpdate);
            }[[~]]
        };[[}]]
        return self;
    })
