var redis       = require('redis'),
    async       = require('async'),
    check       = require('validator').check,
    sanitize    = require('validator').sanitize,
    poolModule  = require('generic-pool');

var App;
var Base;
var Collection;

function Redis() {}
var p = Redis.prototype;
/**
 * Redis singleton initialization method. Using the passed-in params, which can
 * be stored in your configuration file, we define the connection params for your
 * Redis server as well as desired size of the connection pool.
 * @param hOpts
 */
p.init = function(hOpts) {
    this.dbPool = new poolModule.Pool({
        name     : 'redis',
        create   : function(callback) {
            var c = redis.createClient(hOpts.nWritePort, hOpts.sWriteServer,{});
            c.on("error", function (err) {
                console.log(err);
                c.quit();
            });
            callback(null, c);
        },
        destroy  : function(oClient) {
            if (oClient)
                return oClient.quit();
        },
        idleTimeoutMillis: hOpts.nTimeoutMilliseconds,
        reapIntervalMillis: hOpts.nReapIntervalMilliseconds,
        log: false,
        max: hOpts.nMaxConnections,
        priorityRange : 3
    });
    this.dbSubPool = new poolModule.Pool({
        name     : 'redis_sub',
        create   : function(callback) {
            var c = redis.createClient(hOpts.nWritePort, hOpts.sWriteServer,{});
            c.on("error", function (err) {
                console.log(err);
            });
            callback(null, c);
        },
        destroy  : function(oClient) {
            if (oClient)
                return oClient.quit();
        },
        idleTimeoutMillis: hOpts.nTimeoutMilliseconds,
        reapIntervalMillis: hOpts.nReapIntervalMilliseconds,
        log: false,
        max: hOpts.nMaxConnections,
        priorityRange : 3
    });
};
p.acquire = function(fnCallback) {
    if (!App)
        App = require('./../../Core/AppConfig');
    this.dbPool.acquire(fnCallback);
};
p.release = function(oClient) {
    this.dbPool.release(oClient);
};
p.destroy = function(oClient) {
    this.dbPool.destroy(oClient);
};

p.acquireSub = function(fnCallback) {
    if (!App)
        App = require('./../../Core/AppConfig');
    this.dbSubPool.acquire(fnCallback);
};
p.releaseSub = function(oClient) {
    this.dbSubPool.release(oClient);
};
p.destroySub = function(oClient) {
    this.dbSubPool.destroy(oClient);
};

/**
 * All callbacks pass through here to make sure we release our connection properly.
 * @param err
 * @param oClient
 * @param fnCallback
 * @param oResult
 */
p.dispatchResult = function(err,oClient,fnCallback,oResult) {
    if (err)
        console.log(err);
    if (oClient)
        this.release(oClient);
    if (fnCallback)
        fnCallback(err,oResult);
};
/**
 * This method loads an object using the passed-in hQuery, which must be a single name-value
 * pair using either the primary key or a valid secondary lookup field.
 * @param hOpts
 * @param oObj
 * @param fnCallback
 */
p.load = function(hOpts,oObj,fnCallback) {
    var oSelf = this;
    var oClient;
    async.waterfall([
        function(callback) {
            oSelf.acquire(function(err,oResult){
                oClient = oResult;
                if (hOpts.hQuery.nID) {
                    // Primary key lookup. We can get the whole object because we know where to look
                    oClient.hgetall(oObj.nClass+':'+hOpts.hQuery.nID,callback);
                } else {
                    // Secondary lookup, which is just a pointer to the primary key.
                    for (var sLookup in hOpts.hQuery) {
                        oClient.get(oObj.nClass+':'+hOpts.hQuery[sLookup],callback);
                        break; // Only one allowed.
                    }
                }
            });
        }
        ,function(Result,callback) {
            if (Result && Result.nID)
                callback(null,Result);
            else if (Result)
                oClient.hgetall(Result,callback);
            else
                callback();
        }
    ],function(err,hResult){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else {
            oObj.setData(hResult,true);
            if (!hOpts || !hOpts.hExtras)
                oSelf.dispatchResult(err,oClient,fnCallback,oObj);
            else {
                oSelf.release(oClient);
                oSelf.loadExtras(hOpts,oObj,fnCallback);
            }
        }
    });
};
/**
 * This method is used to load 'Extra' properties on other objects when needed. This allows you
 * to load up any or all of an object model's tree of related objects at any time.
 * @param hOpts
 * @param oObj
 * @param fnCallback
 */
p.loadExtras = function(hOpts,oObj,fnCallback){
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        var loadProperty = function(hSubOpts,callback) {
            var sProperty = hSubOpts.sProperty;
            hSubOpts = hSubOpts.hPropertyOpts;

            if (hSubOpts && sProperty) {
                // Increment, Integer and String data types are strictly Redis things.
                var hSettings = oObj.hSettings();
                if (!hSettings.hExtras[sProperty]) {
                    App.error('Trying to loadExtra on property that is not configured: '+sProperty+'; Class: '+oObj.sClass);
                    callback();
                } else if (oObj.get('nID')) {
                    var sKey = oObj.nClass+':'+oObj.get('nID')+':'+sProperty;
                    switch (hSettings.hExtras[sProperty].sType) {
                        case 'Increment':
                        case 'Integer':
                        case 'String':
                            oClient.get(sKey,function(err,res){
                                switch (hSettings.hExtras[sProperty].sType) {
                                    case 'Increment':
                                    case 'Integer':
                                        if (res != undefined) {
                                            try {
                                                check(res).isInt();
                                                oObj[sProperty] = sanitize(res).toInt();
                                            } catch (err1) {
                                                try {
                                                    check(res).isFloat();
                                                    oObj[sProperty] = sanitize(res).toFloat();
                                                } catch (err2) {
                                                    oObj[sProperty] = null;
                                                }
                                            }
                                        }
                                        break;
                                    case 'String':
                                        oObj[sProperty] = res ? res.toString() : '';
                                        break;
                                }
                                callback(err);
                            });

                            break;
                        case 'Object':
                            oClient.get(sKey,function(err,sID){
                                if (err) {
                                    callback(err);
                                } else {
                                    if (!Base)
                                        Base  = require('./../../Core/Base');

                                    oObj[sProperty] = Base.lookup({sClass:hSettings.hExtras[sProperty].sClass});

                                    if (!hSubOpts || hSubOpts.toString() == 'true')
                                        hSubOpts = {};
                                    hSubOpts.hQuery = {nID:sID.replace(oObj[sProperty].nClass+':','')};
                                    oSelf.load(hSubOpts,oObj[sProperty],callback);
                                }
                            });
                            break;
                        case 'Collection':
                            if (hSubOpts == true)
                                hSubOpts = {'sProperty':sProperty};
                            else
                                hSubOpts.sProperty = sProperty;

                            oSelf._loadCollection(hSubOpts,oObj,function(err,cColl){
                                if (err)
                                    callback(err)
                                else if (hSubOpts.hExtras && hSubOpts.hExtras.toString() != 'true') {
                                    (function loop(){
                                        if (oObj[sProperty].next()) {
                                            oSelf.loadExtras({hExtras:hSubOpts.hExtras},oObj[sProperty].getCurrent(),loop,oClient);
                                        } else
                                            callback();
                                    })();
                                } else
                                    callback();
                            },oClient);
                            break;
                    }
                } else {
                    switch (hSettings.hExtras[sProperty].sType) {
                        case 'Increment':
                        case 'Integer':
                        case 'String':
                            // Increment, Integer and String data types are strictly Redis things.
                            oObj[sProperty] = null;

                            break;
                        case 'Object':
                            if (!oObj[sProperty]) {
                                if (!Base)
                                    Base  = require('./../../Core/Base');
                                oObj[sProperty] = Base.lookup({sClass:hSettings.hExtras[sProperty].sClass});
                            }
                            break;
                        case 'Collection':
                            if (!oObj[sProperty]) {
                                if (!Collection)
                                    Collection  = require('./../../Core/Collection');
                                oObj[sProperty] = new Collection({sClass:oObj.hSettings().hExtras[sProperty].sClass});
                            }
                            break;
                    }
                    callback();
                }
            }  else
                callback();
        };

        var q = async.queue(loadProperty,2);
        q.drain = function(err){
            oSelf.dispatchResult(err,oClient,fnCallback,oObj);
        };

        if (hOpts && hOpts.hExtras) {
            for (var sProperty in hOpts.hExtras) {
                q.push({
                    sProperty:sProperty,
                    hPropertyOpts:hOpts.hExtras[sProperty]
                });
            }
            q.push({});
        } else
            fnCallback(null,oObj);
    });
};
//p.loadExtras = function(hOpts,oObj,fnCallback){
//    var oSelf = this;
//
//    var loadProperty = function(hSubOpts,callback) {
//        var sProperty = hSubOpts.sProperty;
//        hSubOpts = hSubOpts.hPropertyOpts;
//        if (hSubOpts && sProperty) {
//            var hSettings = oObj.hSettings();
//            var sKey = oObj.nClass+':'+oObj.get('nID')+':'+sProperty;
//            switch (hSettings.hExtras[sProperty].sType) {
//                case 'Increment':
//                case 'Integer':
//                case 'String':
//                    oSelf.acquire(function(err,oClient){
//                        if (err)
//                            oSelf.dispatchResult(err,oClient,callback,oObj);
//                        else
//                            oClient.get(sKey,function(err,res){
//                                switch (hSettings.hExtras[sProperty].sType) {
//                                    case 'Increment':
//                                    case 'Integer':
//                                        oObj[sProperty] = null;
//                                        if (res != undefined) {
//                                            try {
//                                                check(res).isInt();
//                                                oObj[sProperty] = sanitize(res).toInt();
//                                            } catch (err) {
//                                                try {
//                                                    check(res).isFloat();
//                                                    oObj[sProperty] = sanitize(res).toFloat();
//                                                } catch (err2) {
//
//                                                }
//                                            }
//                                        }
//                                        break;
//                                    case 'String':
//                                        oObj[sProperty] = res ? res.toString() : '';
//                                        break;
//                                }
//                                oSelf.dispatchResult(err,oClient,callback,oObj);
//                            });
//                    });
//                case 'Object':
//                    oSelf.acquire(function(err,oClient){
//                        if (err) {
//                            oSelf.dispatchResult(err,oClient,callback,oObj);
//                        } else
//                            oClient.get(sKey,function(err,sID){
//                                if (err) {
//                                    oSelf.dispatchResult(err,oClient,callback,oObj);
//                                } else {
//                                    if (!oObj[sProperty]) {
//                                        if (!Base)
//                                            Base  = require('./../../Core/Base');
//
//                                        // TODO: Support sPath for classes.
//                                        oObj[sProperty] = Base.lookup({sClass:hSettings.hExtras[sProperty].sClass});
//                                    }
//                                    if (!hSubOpts || hSubOpts.toString() == 'true')
//                                        hSubOpts = {};
//                                    hSubOpts.hQuery = {nID:sID.replace(oObj[sProperty].nClass+':','')};
//                                    oSelf.release(oClient);
//                                    oSelf.load(hSubOpts,oObj[sProperty],callback);
//                                }
//                            });
//                    });
//                    break;
//                case 'Collection':
//                    if (!oObj[sProperty]) {
//                        if (!Collection)
//                            Collection  = require('./../../Core/Collection');
//                        oObj[sProperty] = new Collection({sClass:oObj.hSettings().hExtras[sProperty].sClass});
//                    }
//
//                    if (!hSubOpts.bReverse)
//                        hSubOpts.bReverse = oObj.hSettings().hExtras[sProperty].bReverse;
//
//                    oSelf._loadCollection(sKey,hSubOpts,oObj[sProperty],function(err,cColl){
//                        oObj[sProperty] = cColl;
//
//                        if (hSubOpts.hExtras && hSubOpts.hExtras.toString() != 'true') {
//                            (function loop(){
//                                if (oObj[sProperty].next()) {
//                                    oSelf.loadExtras({hExtras:hSubOpts.hExtras},oObj[sProperty].getCurrent(),loop);
//                                } else
//                                    callback();
//                            })();
//                        } else
//                            callback(err);
//                    });
//                    break;
//            }
//        }  else
//            callback();
//    };
//
//    var q = async.queue(loadProperty,2);
//
//    if (hOpts && hOpts.hExtras)
//        for (var sProperty in hOpts.hExtras) {
//            q.push({
//                sProperty:sProperty,
//                hPropertyOpts:hOpts.hExtras[sProperty]
//            });
//            q.drain = function(err){
//                fnCallback(err,oObj);
//            };
//        }
//    else
//        fnCallback(null,oObj);
//};
/**
 * Loads collection extra as a property on the oObj passed in via hOpts.
 * @param hOpts
 * @param fnCallback
 * @private
 */
p._loadCollection = function(sKey,hOpts,cColl,fnCallback) {
    if (sKey) {
        var oSelf = this;
        oSelf.acquire(function(err,oClient){
            if (err)
                fnCallback(err);
            else {
                // Pass down all the configuration options required to construct the collection appropriately.

                cColl.nIndex = (hOpts) ? hOpts.nIndex || 0 : 0;
                cColl.nSize = (hOpts) ? hOpts.nSize || 0 : 0;
                cColl.nMin = (hOpts) ? hOpts.nMin || 0 : 0;
                cColl.nFirstID = (hOpts) ? hOpts.nFirstID || null : null;
                cColl.bReverse = (hOpts) ? hOpts.bReverse || false : false;

                async.waterfall([
                    function(callback) {
                        // If your collection is a forward-looking one, you can limit by setting nMin to the minimum datestamp (or other sorted score) required.
                        oClient.zcount(sKey,cColl.nMin,7260818340000,callback);
                    },
                    function(nTotal,callback){
                        cColl.nTotal = nTotal;
                        if (cColl.nFirstID) {
                            oClient.zrank(sKey,cColl.nClass+':'+cColl.nFirstID,callback);
                        } else
                            callback(null,null);
                    },
                    function(nFirstIdIndex,callback){
                        if (cColl.bReverse) {
                            cColl.nStart = (nFirstIdIndex) ? (Number(cColl.nTotal)-(Number(nFirstIdIndex)+1)) : (cColl.nIndex) ? (Number(cColl.nIndex)*Number(cColl.nSize)) : 0;
                            cColl.nEnd = (cColl.nSize) ? (Number(cColl.nStart) + Number(cColl.nSize) + 1) : -1;
                            oClient.zrevrange(sKey,cColl.nStart,cColl.nEnd,callback);
                        } else {
                            cColl.nStart = (nFirstIdIndex) ? nFirstIdIndex : (cColl.nIndex) ? (Number(cColl.nIndex)*Number(cColl.nSize)) : 0;
                            cColl.nEnd = (cColl.nSize) ? (Number(cColl.nStart) + Number(cColl.nSize)) : -1;
                            oClient.zrange(sKey,cColl.nStart,cColl.nEnd,callback);
                        }
                    }
                ],function(err,aResults){
                    if (err) {
                        oSelf.dispatchResult(err,oClient,fnCallback,cColl);
                    } else if (!aResults || aResults.length == 0) {
                        fnCallback(null,cColl);
                    } else {
                        var multi = oClient.multi();
                        for (var i = 0; i < aResults.length; i++) {
                            multi.hgetall(aResults[i]);
                        }
                        multi.exec(function(err,aResults2){
                            if (err)
                                oSelf.dispatchResult(err,oClient,fnCallback);
                            else {
                                // Keep track of missing items. If any are found, remove them and retry this call.
                                var nMissing = 0;
                                for (var i = 0; i < aResults2.length; i++) {
                                    if (aResults2[i] && aResults2[i].nID) {
                                        if (i == cColl.nSize && cColl.nSize > 0) {
                                            cColl.nNextID = aResults2[i].nID;
                                        } else if (i < cColl.nSize || !cColl.nSize) {
                                            cColl.add(aResults2[i],true);
                                        }
                                    } else
                                        nMissing++;
                                }

                                if (nMissing > 0) {
                                    cColl.empty();
                                    oSelf._cleanSet(sKey,function(){
                                        oSelf._loadCollection(sKey,hOpts,cColl,fnCallback);
                                    });
                                } else
                                    oSelf.dispatchResult(null,oClient,fnCallback,cColl);
                            }
                        });
                    }
                });
            }
        });
    } else
        fnCallback('Missing either oObj or sProperty.');
};
/**
 * When objects are removed, often they are referenced in one or more sorted sets.
 * When we come across these we need to clean up the collections.
 * @param sKeys
 * @param fnCallback
 */
p._cleanSet = function(sKeys,fnCallback){
    var oSelf = this;
    var cleanKey = function(sKey,callback) {
        if (sKey) {
            oSelf.acquire(function (err, oClient) {
                if (err) {
                    oSelf.dispatchResult(err,oClient,callback);
                } else {
                    oClient.zrange(sKey,0,-1,function(err,aResult){
                        if (err || !aResult || !aResult.length) {
                            oSelf.dispatchResult(err,oClient,callback);
                        } else {
                            var multi = oClient.multi();
                            var aMap = [];
                            for (var i = 0; i < aResult.length; i++) {
                                multi.hgetall(aResult[i]);
                                aMap.push(aResult[i]);
                            }
                            multi.exec(function(err,aObjects){
                                if (err || !aObjects || !aObjects.length)
                                    callback(err);
                                else {
                                    multi = oClient.multi();
                                    for (var i = 0; i < aObjects.length; i++) {
                                        if (!aObjects[i]) {
                                            multi.zrem(sKey,aMap[i]);
                                        }
                                    }
                                    multi.exec(function(err,aDone){
                                        oSelf.dispatchResult(err,oClient,callback);
                                    });
                                }
                            });
                        }
                    });
                }
            });
        } else
            callback();
    };

    // Loop through the passed-in keys identifying the sorted sets that have dead pointers in them.
    var q = async.queue(cleanKey,1);
    q.drain = function(){
        fnCallback();
    };
    var aKeys = sKeys.split(',');
    for (var i = 0; i < aKeys.length; i++) {
        q.push(aKeys[i]);
    }
    q.push('');
};
/**
 * This method saves the object to redis via the HMSET call.
 * @param oObj - The object being saved.
 * @param fnCallback - The callback function  (optional).
 */
p.saveObject = function(hOpts,oObj,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else {
            var nTTL = (hOpts && hOpts.nTTL) ? hOpts.nTTL : oObj.hSettings().nTTL;
            var sKey = (hOpts && hOpts.sKey) ? hOpts.sKey : oObj.nClass+':'+oObj.get('nID');
            var multi = oClient.multi();

            // Delete the key from Redis first. Otherwise, you won't ever be able to remove anything from an object's hData.
            multi.del(sKey);
            // We only store what's in hData. Any extra properties are saved automatically when calling setExtra.
            multi.hmset(sKey,oObj.hData);

            // If the object doesn't need to live on in Redis forever you can set it to expire.
            if (nTTL)
                multi.expire(sKey,nTTL);

            // If the object definition includes anything in aSecondaryLookupKeys, then
            // the app needs to be able to lookup the object with that value. Store a pointer there.
            if (oObj.hSettings().aSecondaryLookupKeys) {
                for (var i = 0; i < oObj.hSettings().aSecondaryLookupKeys.length; i++) {
                    if (oObj.get(oObj.hSettings().aSecondaryLookupKeys[i])) {
                        multi.set(oObj.nClass+':'+oObj.get(oObj.hSettings().aSecondaryLookupKeys[i]),oObj.nClass+':'+oObj.get('nID'));
                        // The object pointer must also be set to expire if the data it's pointing to is going to expire.
                        if (nTTL)
                            multi.expire(oObj.nClass+':'+oObj.get(oObj.hSettings().aSecondaryLookupKeys[i]),nTTL);
                    }
                }
            }

            multi.exec(function(err) {
                oSelf.dispatchResult(err,oClient,fnCallback,oObj);
            });
        }
    });
};
/**
 * This method removes the item from Redis using its nID value.
 * @param oObj
 * @param fnCallback
 */
p.deleteObject = function(oObj,fnCallback){
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else {
            var multi = oClient.multi();
            multi.del(oObj.nClass+':'+oObj.get('nID'));
            var hExtras = oObj.hSettings().hExtras;
            for (var sProperty in hExtras) {
                multi.del(oObj.nClass+':'+oObj.get('nID')+':'+sProperty);
            }
            if (oObj.hSettings().aSecondaryLookupKeys) {
                for (var i = 0; i < oObj.hSettings().aSecondaryLookupKeys.length; i++) {
                    if (oObj.get(oObj.hSettings().aSecondaryLookupKeys[i])) {
                        multi.del(oObj.nClass+':'+oObj.get(oObj.hSettings().aSecondaryLookupKeys[i]));
                    }
                }
            }
            multi.exec(function(err,res){
                oSelf.dispatchResult(err,oClient,fnCallback,res);
            });
        }
    });
};
/**
 * This method is used to add or replace items in a Redis Set, which is an unordered list of objects.
 * In our framework, we always only store primary key ids in these lists and these ids simply point to
 * full objects stored in Redis by those keys.
 *
 * @param hOpts - Hash expecting sKey, sValue and an optional nTTL value if the set should expire at any point.
 * @param oObj
 * @param fnCallback
 */
p.addToSet = function(hOpts,oObj,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else {
            if (hOpts && hOpts.sKey) {
                var sSortBy = (hOpts.sSortBy) ? hOpts.sSortBy : 'nCreated';
                var nTTL = (hOpts.nTTL) ? hOpts.nTTL : oObj.hSettings().nTTL;
                var multi = oClient.multi();
                multi.zrem(hOpts.sKey,[oObj.nClass+':'+oObj.get('nID')]);
                multi.zadd(hOpts.sKey,oObj.get(sSortBy),[oObj.nClass+':'+oObj.get('nID')]);
                if (nTTL)
                    multi.expire(hOpts.sKey,nTTL); // in seconds
                multi.exec(function(err){
                    oSelf.dispatchResult(err,oClient,fnCallback,oObj);
                });
            } else
                oSelf.dispatchResult('sKey missing.',oClient,fnCallback);
        }
    });
};
/**
 * This method is used for increment values in redis, a quick and thread-safe way to count things.
 * @param hOpts
 * @param nValue
 * @param fnCallback
 */
p.increment = function(hOpts,nValue,fnCallback) {
    var oSelf = this;
    if (hOpts && hOpts.sKey) {
        oSelf.acquire(function(err,oClient){
            if (err)
                oSelf.dispatchResult(err,oClient,fnCallback);
            else {
                if (hOpts.nTTL) {
                    var multi = oClient.multi();
                    multi.incrby(hOpts.sKey,nValue);
                    multi.expire(hOpts.sKey,hOpts.nTTL); // in seconds
                    multi.exec(function(err,aResult){
                        oSelf.dispatchResult(err,oClient,fnCallback,aResult[0]);
                    });
                } else
                    oClient.incrby(hOpts.sKey,nValue,function(err,res){
                        oSelf.dispatchResult(err,oClient,fnCallback,res);
                    });
            }
        });
    } else
        oSelf.dispatchResult('sKey missing.',oClient,fnCallback);
};
/**
 * Set value at passed-in sKey, with the option of setting an expiration on the item.
 * @param hOpts
 * @param Value
 * @param fnCallback
 */
p.set = function(hOpts,Value,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else {
            // Added this here because mysql doesn't care about the nClass.
            if (hOpts.nClass)
                Value = hOpts.nClass+':'+Value;

            if (hOpts && hOpts.nTTL) {
                var multi = oClient.multi();
                multi.set(hOpts.sKey,Value);
                multi.expire(hOpts.sKey,hOpts.nTTL);
                multi.exec(function(err){
                    oSelf.dispatchResult(err,oClient,fnCallback,Value);
                });
            } else {
                oClient.set(hOpts.sKey,Value,function(err){
                    oSelf.dispatchResult(err,oClient,fnCallback,Value);
                });
            }
        }
    });
};
/**
 * We use Redis to hand out primary key id values for every object in the system.
 * The App singleton stores whether we've seeded the environment with the first
 * ID, which is set in global config under nStartingID.
 * @param oObj
 * @param fnCallback
 */
p.getNextID = function(oObj,fnCallback) {
    var oSelf = this;
    // This is a top-priority item.
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else {
            if (!this.bSeeded) {
                this.bSeeded = true;
                var multi = oClient.multi();
                multi.setnx('nSeedID',App.nStartingID);
                multi.incrby('nSeedID',1);
                multi.exec(function(err,aResult){
                    if (aResult && aResult[1])
                        oObj.set('nID',aResult[1]);

                    oSelf.dispatchResult(err,oClient,fnCallback);
                });
            } else
                oClient.incrby('nSeedID',1,function(err,nID){
                    if (nID)
                        oObj.set('nID',nID);
                    oSelf.dispatchResult(err,oClient,fnCallback);
                });
        }
    });
};
// Low-level pass-thru to Redis' native functions. //
/**
 * http://redis.io/commands/get
 * @param sKey
 * @param fnCallback
 */
p.get = function(sKey,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else
            oClient.get(sKey,function(err,res){
                oSelf.dispatchResult(err,oClient,fnCallback,res);
            });
    });
};
/**
 * http://redis.io/commands/zremrangebyrank
 * @param sKey
 * @param nStart
 * @param nEnd
 * @param fnCallback
 */
p.zremrangebyrank = function(sKey,nStart,nEnd,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else
            oClient.zremrangebyrank(sKey,nStart,nEnd,function(err,res){
                oSelf.dispatchResult(err,oClient,fnCallback,res);
            });
    });
};
/**
 * http://redis.io/commands/zrem
 * @param sKey
 * @param sID
 * @param fnCallback
 */
p.zrem = function(sKey,sID,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else
            oClient.zrem(sKey,sID,function(err,res){
                oSelf.dispatchResult(err,oClient,fnCallback,res);
            });
    });
};
/**
 * http://redis.io/commands/del
 * @param sKey
 * @param fnCallback
 */
p.del = function(sKey,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else
            oClient.del(sKey,function(err,res){
                oSelf.dispatchResult(err,oClient,fnCallback,res);
            });
    });
};
/**
 * http://redis.io/commands/publish
 * @param sKey
 * @param sValue
 * @param fnCallback
 */
p.publish = function(sKey,sValue,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else
            oClient.publish(sKey,sValue,function(err,res){
                oSelf.dispatchResult(err,oClient,fnCallback,res);
            });
    });
};
/**
 * http://redis.io/commands/rpush
 * @param sKey
 * @param sValue
 * @param fnCallback
 */
p.rpush = function(sKey,sValue,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else {
            oClient.rpush(sKey,sValue,function(err,res){
                oSelf.dispatchResult(err,oClient,fnCallback,res);
            });
        }
    });
};

p.blpop = function(sKey1,sKey2,nTimeout,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else {
            oClient.blpop(sKey1,sKey2,nTimeout,function(err,res){
                oSelf.dispatchResult(err,oClient,fnCallback,res);
            });
        }
    });
};


/**
 * http://redis.io/commands/keys
 * @param sKey
 * @param fnCallback
 */
p.keys = function(sKey,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchError(err,oClient,fnCallback);
        else
            oClient.keys(sKey,function(err,res){
                oSelf.release(oClient);
                if (fnCallback)
                    fnCallback(err,res);
            });
    });
};
/**
 * This method merges all sorted sets matching the passed-in keys. Used for news presentation.
 * @param aKeys
 * @param fnCallback
 */
p.zmerge = function(aKeys,cColl,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function (err, oClient) {
        if (err)
            oSelf.dispatchError(err, oClient, fnCallback);
        else {
            var sTempId = aKeys.join(':');
            var multi = oClient.multi();
            multi.zunionstore([sTempId, aKeys.length].concat(aKeys));
            multi.expire(sTempId,86400);
            multi.zcount(sTempId,0,7260818340000);

            cColl.nIndex = cColl.nIndex || 0;
            cColl.nSize = cColl.nSize || 0;

            if (cColl.nFirstID) {
                multi.zrank(sTempId,App.nClass_News+':'+cColl.nFirstID);
                multi.exec(function(err,aResults){
                    if (err)
                        oSelf.dispatchError(err,oClient,fnCallback);
                    else {
                        multi = oClient.multi();

                        cColl.nTotal = aResults[2];
                        var nItemIndex = aResults[3];

                        if (cColl.bReverse) {
                            cColl.nStart = (nItemIndex) ? (Number(cColl.nTotal)-(Number(nItemIndex)+1)) : (cColl.nIndex) ? (Number(cColl.nIndex)*Number(cColl.nSize)) : 0;
                            cColl.nEnd = (cColl.nSize) ? (Number(cColl.nStart) + Number(cColl.nSize) + 1) : -1;
                            multi.zrevrange(sTempId,cColl.nStart,cColl.nEnd);
                        } else {
                            cColl.nStart = (nItemIndex) ? nItemIndex : (cColl.nIndex) ? (Number(cColl.nIndex)*Number(cColl.nSize)) : 0;
                            cColl.nEnd = (cColl.nSize) ? (Number(cColl.nStart) + Number(cColl.nSize)) : -1;
                            multi.zrange(sTempId,cColl.nStart,cColl.nEnd);
                        }

                        multi.exec(function(err,aResults2){
                            multi = oClient.multi();
                            var aResultMap = [];
                            for (var i = 0; i < aResults2[0].length; i++) {
                                multi.hgetall(aResults2[0][i]);
                                aResultMap.push(aResults2[0][i]);
                            }

                            multi.exec(function(err,aResults3){
                                // Keep track of missing items. If any are found, remove them and retry this call.
                                var nMissing = 0;
                                for (var i = 0; i < aResults3.length; i++) {
                                    if (aResults3[i]) {
                                        if (i >= cColl.nSize && cColl.nSize > 0) {
                                            cColl.nNextID = aResults3[i].nID;
                                        } else
                                            cColl.add(aResults3[i]);
                                    } else
                                        nMissing++;
                                }

                                if (nMissing > 0) {
                                    cColl.empty();
                                    oSelf.cleanSet(aKeys,function(){
                                        oSelf.zmerge(aKeys,cColl,fnCallback);
                                    });
                                } else {
                                    oSelf.release(oClient);
                                    // Finally, we should have everything.
                                    fnCallback(null,cColl);
                                }
                            });
                        });
                    }
                });


            } else {

                if (cColl.bReverse) {
                    cColl.nStart = (cColl.nIndex) ? (Number(cColl.nIndex)*Number(cColl.nSize)) : 0;
                    cColl.nEnd = (cColl.nSize) ? (Number(cColl.nStart) + Number(cColl.nSize)) : -1;
                    multi.zrevrange(sTempId,cColl.nStart,cColl.nEnd);
                } else {
                    cColl.nStart = (nItemIndex) ? nItemIndex : (cColl.nIndex) ? (Number(cColl.nIndex)*Number(cColl.nSize)) : 0;
                    cColl.nEnd = (cColl.nSize) ? (Number(cColl.nStart) + Number(cColl.nSize)) : -1;
                    multi.zrange(sTempId,cColl.nStart,cColl.nEnd);
                }

                multi.exec(function(err,aResults){
                    if (err)
                        oSelf.dispatchError(err,oClient,fnCallback);
                    else {
                        cColl.nTotal = aResults[2];
                        multi = oClient.multi();
                        var aResultMap = [];
                        for (var i = 0; i < aResults[3].length; i++) {
                            multi.hgetall(aResults[3][i]);
                            aResultMap.push(aResults[3][i]);
                        }

                        multi.exec(function(err,aResults2){
                            // Keep track of missing items. If any are found, remove them and retry this call.
                            var nMissing = 0;
                            for (var i = 0; i < aResults2.length; i++) {
                                if (aResults2[i] && aResults2[i].nID) {
                                    if (i == cColl.nSize && cColl.nSize > 0) {
                                        cColl.nNextID = aResults2[i].nID;
                                    } else
                                        cColl.add(aResults2[i]);
                                } else {
                                    nMissing++;
                                }
                            }
                            if (nMissing > 0) {
                                cColl.empty();
                                oSelf.cleanSet(aKeys,function(){
                                    oSelf.zmerge(aKeys,cColl,fnCallback);
                                });
                            } else {
                                oSelf.release(oClient);
                                // Finally, we should have everything.
                                fnCallback(null,cColl);
                            }
                        });
                    }
                });
            }
        }
    });
};

p.hgetall = function(sKey,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else
            oClient.hgetall(sKey,function(err,hResult){
                console.log('BACK FROM hgetall');
                oSelf.dispatchResult(err,oClient,fnCallback,hResult);
            });
    });
};

p.hdel = function(sKey,aKeys,fnCallback) {
    var oSelf = this;
    async.waterfall([
        function(callback){
            oSelf.acquire(callback);
        }
        ,function(oResult,callback) {
            oClient = oResult;
            var nCount = 0;
            (function loop(i){
                if (aKeys[i])
                    oClient.hdel(sKey,aKeys[i],function(err,res){
                        if (err)
                            callback(err);
                        else
                            nCount+=res;
                        loop(i+1);
                    });
                else
                    callback(null,nCount);
            })(0);

        }
    ],function(err,oResult){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else {
            oSelf.dispatchResult(err,oClient,fnCallback,oResult);
        }
    });
};

module.exports = new Redis();

