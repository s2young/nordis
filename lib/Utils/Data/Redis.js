var redis       = require('redis'),
    async       = require('async');

var Config;
var Base;
var Collection;

function Redis() {
}
var p = Redis.prototype;
/**
 * Redis singleton initialization method. Using the passed-in params, which can
 * be stored in your configuration file, we define the connection params for your
 * Redis server as well as desired size of the connection pool.
 * @param hOpts
 */
p.init = function(hOpts) {
    var oSelf = this;

    if (hOpts.sHost)
        hOpts = {default:hOpts};
    
    oSelf.hOpts = hOpts;
    oSelf.opts = {};
};

p.createClient = function(sPool,sDbAlias,fnCallback){
    var oSelf = this;
    if (oSelf.hOpts[sDbAlias].sPassword) oSelf.opts.auth_pass = oSelf.hOpts[sDbAlias].sPassword;
    if (oSelf.hOpts[sDbAlias].nRetries == undefined) oSelf.hOpts[sDbAlias].nRetries = 0;

    console.log('createClient ('+sPool+','+sDbAlias+'): '+oSelf.hOpts[sDbAlias].nPort+','+oSelf.hOpts[sDbAlias].sHost,oSelf.opts);
    if (oSelf.hOpts[sDbAlias].bSkip) {
        fnCallback();
    } else if (sPool) {
        if (!oSelf[sPool]) oSelf[sPool] = {nRetries:0};
        if (!Config) {
            Base = require('./../../Base');
            Config = require('./../../AppConfig');
        }

        oSelf[sPool][sDbAlias] = redis.createClient(oSelf.hOpts[sDbAlias].nPort,oSelf.hOpts[sDbAlias].sHost,oSelf.opts);
        oSelf[sPool][sDbAlias].sHashKey = (oSelf.hOpts[sDbAlias].nDb) ?  '{'+oSelf.hOpts[sDbAlias].nDb+'}' : '';
        oSelf[sDbAlias] = {sHashKey:oSelf[sPool][sDbAlias].sHashKey};
        oSelf[sPool][sDbAlias].on('error',function(err){
            oSelf.hOpts[sDbAlias].nRetries++;
            if (oSelf.hOpts[sDbAlias].nRetries < 5) {
                var nTO = (Number(oSelf.hOpts[sDbAlias].nRetries)*5000);
                setTimeout(function(){
                    oSelf.createClient(sPool,sDbAlias,fnCallback);
                },nTO);
            } else {
                delete oSelf[sPool][sDbAlias];
                // Mark redis as down and send fatal error.
                Config.warn('TURNING REDIS OFF. Requires a restart of the app to reset.');
                oSelf.hOpts[sDbAlias].bSkip = true;
                Config.fatal(err);
                fnCallback(err);
            }
        });
        oSelf[sPool][sDbAlias].on('connect',function(){
            console.log(sPool+' ('+sDbAlias+') connected.');
            oSelf.hOpts[sDbAlias].nRetries = 0;
            oSelf.hOpts[sDbAlias].bSkip = false;
            fnCallback(null, oSelf[sPool][sDbAlias]);
        });
    } else {
        var oClient = redis.createClient(oSelf.hOpts[sDbAlias].nPort,oSelf.hOpts[sDbAlias].sHost,oSelf.opts);
        oClient.on('error',function(err){
            oSelf.hOpts[sDbAlias].nRetries++;
            if (oSelf.hOpts[sDbAlias].nRetries < 5) {
                var nTO = (Number(oSelf.hOpts[sDbAlias].nRetries)*5000);
                setTimeout(function(){
                    oSelf.createClient(sPool,sDbAlias,fnCallback);
                },nTO);
            } else {
                oSelf.hOpts[sDbAlias].bSkip = true;
                Config.warn('TURNING REDIS OFF. Requires a restart of the app to reset.');
                // Mark redis as down and send fatal error.
                Config.fatal(err);
                fnCallback(err);
            }
        });
        oClient.on('connect',function(){
            oSelf.hOpts[sDbAlias].bSkip = false;
            oSelf.hOpts[sDbAlias].nRetries = 0;
            fnCallback(null,oClient);
        });
    }
};

p.acquire = function(fnCallback,sDbAlias,nRetry) {
    var oSelf = this;
    sDbAlias = (oSelf.hOpts[sDbAlias]) ? sDbAlias : 'default';

    if (!oSelf.dbPool || !oSelf.dbPool[sDbAlias])
        oSelf.createClient('dbPool',sDbAlias,fnCallback);
    else
        fnCallback(null, oSelf.dbPool[sDbAlias]);
};
p.acquirePub = function(fnCallback,sDbAlias) {
    var oSelf = this;
    sDbAlias = (sDbAlias) ? sDbAlias : 'default';
    if (!oSelf.dbPubPool || !oSelf.dbPubPool[sDbAlias])
        oSelf.createClient('dbPubPool',sDbAlias,fnCallback);
    else
        fnCallback(null,oSelf.dbPubPool[sDbAlias]);
};
p.acquireSub = function(fnCallback,sDbAlias) {
    var oSelf = this;
    sDbAlias = (sDbAlias) ? sDbAlias : 'default';
    if (!oSelf.dbSubPool || !oSelf.dbSubPool[sDbAlias]) {
        if (!oSelf.dbSubPool) oSelf.dbSubPool = {};

        if (!Config) {
            Base = require('./../../Base');
            Config = require('./../../AppConfig');
        }
        oSelf.createClient('dbSubPool',sDbAlias,fnCallback);
    } else
        fnCallback(null,oSelf.dbSubPool[sDbAlias]);
};
p.release = function(oClient,oObj) {

};
p.releaseSub = function(oClient) {
    //this.dbSubPool.release(oClient);
};
p.destroySub = function(oClient) {
    //this.dbSubPool.release(oClient);
};
/**
 * All callbacks pass through here to make sure we release our connection properly.
 * @param err
 * @param oClient
 * @param fnCallback
 * @param oResult
 */
p.dispatchResult = function(err,oResult,fnCallback) {
    if (err instanceof Array && err[0].toString().match('maxmemory')) {
        Config.fatal('Redis is out of memory!');
    }
    if (fnCallback)
        setImmediate(function(){
            fnCallback(err,oResult);
        });
};
/**
 * This method loads an object using the passed-in hQuery, which must be a single name-value
 * pair using either the primary key or a valid secondary lookup field.
 * @param hOpts
 * @param oObj
 * @param fnCallback
 */
p.loadObject = function(hOpts,oObj,fnCallback) {
    var oSelf = this;
    var oClient;
    var sKeyProperty = oObj.getSettings().sKeyProperty;
    var sDbAlias = (oSelf.hOpts[oObj.getSettings().sDbAlias]) ? oObj.getSettings().sDbAlias : 'default';
    var bSkip = (oSelf.hOpts[sDbAlias].bSkip||oObj.getKey()||hOpts.sSource=='MySql'||(hOpts.hQuery && (hOpts.hQuery.sWhere||hOpts.hQuery.aStatements)));

    if (!Config) {
        Base = require('./../../Base');
        Config = require('./../../AppConfig');
    }

    async.series([
        function(callback) {
            if (bSkip) {
                delete oObj.sSource;
                callback(null,null);
            } else
                oSelf.acquire(function(err,oResult){
                    if (err||!oResult)
                        callback(err||'No connection.');
                    else {
                        oClient = oResult;

                        if (hOpts.hQuery[sKeyProperty]) {
                            // Primary key lookup. We can get the whole object because we know where to look
                            oClient.hgetall(oClient.sHashKey+oObj.getClass()+':'+hOpts.hQuery[sKeyProperty],function(err,hResult){
                                if (hResult) {
                                    oObj.hData = hResult;
                                    oObj.sSource = 'Redis';
                                }
                                callback(err);
                            });
                        } else {
                            var sKey;
                            // Secondary lookup, which is just a pointer to the primary key.
                            if (hOpts.hQuery && Object.keys(hOpts.hQuery).length==1) {
                                for (var sLookup in hOpts.hQuery) {
                                    // If only one is passed in, we assume it's an attempt to lookup by a secondary key. Otherwise, we skip redis altogether.
                                    if (hOpts.hQuery[sLookup] && oObj.getSettings() && oObj.getSettings().hProperties && oObj.getSettings().hProperties[sLookup] && (oObj.getSettings().hProperties[sLookup].bPrimary || oObj.getSettings().hProperties[sLookup].bUnique)) {
                                        sKey = oObj.getClass()+':'+hOpts.hQuery[sLookup];
                                        break;
                                    }
                                }
                            }

                            if (sKey) {
                                //Config.trace(oObj.sID,{Redis:{sID:oClient.sID},hQuery:hOpts.hQuery,sKey:sKey});
                                oClient.hmget(oClient.sHashKey+'KEYS',sKey,function(err,res){
                                    if (err || !res || !res.length)
                                        callback(err,null);
                                    else {
                                        oClient.hgetall(res[0],function(err,hResult){
                                            if (hResult) {
                                                oObj.hData = hResult;
                                                oObj.sSource = 'Redis';
                                            }
                                            callback(err);
                                        });
                                    }
                                });
                            } else
                                callback(null,null);
                        }
                    }
                },sDbAlias);
        }
    ],function(err){
        oSelf.dispatchResult(err,oObj,fnCallback);
    });
};

p.loadCollection = function(hOpts,oObj,fnCallback) {
    var oSelf = this;
    var sDbAlias = (oSelf.hOpts[oObj.getSettings().sDbAlias]) ? oObj.getSettings().sDbAlias : 'default';

    if (oSelf.hOpts[sDbAlias].bSkip || (hOpts && hOpts.sSource == 'MySql') || (hOpts.hQuery && (hOpts.hQuery.sWhere ||hOpts.hQuery.aStatements)))
        fnCallback();
    else {
        oSelf.acquire(function(err,oClient){
            if (err)
                oSelf.dispatchResult(err,oObj,fnCallback);
            else
                async.waterfall([
                    function(callback){
                        if (hOpts && (hOpts.nMin || hOpts.nMax))
                            oClient.zcount(oClient.sHashKey+hOpts.sKey,(hOpts.nMin||0),(hOpts.nMax||726081834000),callback);
                        else
                            oClient.zcard(oClient.sHashKey+hOpts.sKey,callback);
                    }
                    ,function(nTotal,callback){
                        oObj.nTotal = nTotal;

                        if (!nTotal)
                            callback();
                        else {
                            oObj.sSource = 'Redis';
                            oObj.nSize = (hOpts && hOpts.nSize) ? hOpts.nSize : 0;
                            oObj.sFirstID = (hOpts && hOpts.sFirstID) ? hOpts.sFirstID : null;
                            oObj.bReverse = (hOpts && hOpts.bReverse) ? true : false;
                            delete oObj.nNextID;

                            async.waterfall([
                                function(cb){
                                    // First we must determine the range (starting and ending index) to retrieve.
                                    if (!oObj.sFirstID)
                                        cb(null,0);
                                    else if (oObj.bReverse)
                                        oClient.zrevrank(oClient.sHashKey+hOpts.sKey,oClient.sHashKey+oObj.getClass()+':'+oObj.sFirstID,cb);
                                    else
                                        oClient.zrank(oClient.sHashKey+hOpts.sKey,oClient.sHashKey+oObj.getClass()+':'+oObj.sFirstID,cb);
                                }
                                ,function(nStart,cb){
                                    oObj.nStart = parseFloat(nStart) || 0;
                                    oObj.nEnd = (oObj.nSize) ? (oObj.nStart+oObj.nSize+1) : -1;
                                    delete oObj.sFirstID;

                                    // The sorted set only has pointers, so we must load the individual items in the collection.
                                    var handleResult = function(err,aResult) {
                                        delete oObj.nStart;
                                        delete oObj.nEnd;
                                        delete oObj.bReverse;

                                        // Every page is a fresh start. We don't append page after page.
                                        oObj.aObjects = [];

                                        // If we have a size limit, lop off the last item before processing.
                                        if (oObj.nSize && aResult && aResult[oObj.nSize]) {
                                            oObj.nNextID = parseFloat(aResult[oObj.nSize].toString().replace(/^[^:]*\:/,''));
                                            aResult.splice(-1,1);
                                            oObj.nCount = aResult.length;
                                        } else if (aResult)
                                            oObj.nCount = aResult.length;

                                        if (aResult) {
                                            var nMissing = 0;
                                            async.forEach(aResult,function(sItemKey,cback){
                                                oClient.hgetall(sItemKey,function(err,res){
                                                    if (err)
                                                        cback(err);
                                                    else if (!res) {
                                                        oClient.zrem(oClient.sHashKey+hOpts.sKey,sItemKey);
                                                        nMissing++;
                                                        cback();
                                                    } else if (hOpts && hOpts.hExtras) {
                                                        var oItem = oObj.add(res,true);
                                                        oItem.loadExtras(hOpts.hExtras,cback);
                                                    } else if (!hOpts.nSize || oObj.aObjects.length < hOpts.nSize) {
                                                        var oItem = oObj.add(res,true);
                                                        cback();
                                                    } else {
                                                        if (!Base) Base = require('./../../Base');
                                                        var oItem = Base.cast(res,oObj.sClass);
                                                        oObj.sFirstID = oItem.getKey();
                                                        cback();
                                                    }
                                                });
                                            },function(){
                                                if (nMissing) {
                                                    oSelf.loadCollection(hOpts,oObj,fnCallback);
                                                } else {
                                                    //if (oObj.nNextID && oObj.nNextID==oObj.sFirstID)
                                                    //    delete oObj.nNextID;
                                                    //delete oObj.sFirstID;

                                                    cb();
                                                }
                                            });
                                        } else
                                            cb();
                                    };

                                    if (oObj.bReverse)
                                        oClient.zrevrange(oClient.sHashKey+hOpts.sKey,oObj.nStart,oObj.nEnd,handleResult);
                                    else
                                        oClient.zrange(oClient.sHashKey+hOpts.sKey,oObj.nStart,oObj.nEnd,handleResult);
                                }
                            ],callback);
                        }
                    }
                ],fnCallback);
        });
    }
};
/**
 * This method saves the object to redis via the HMSET call.
 * @param hOpts - Optional hash that can include nTTL (time-to-live expiration) and/or sKey (keyname in redis)
 * @param oObj - The object being saved.
 * @param fnCallback - The callback function  (optional).
 */
p.saveObject = function(hOpts,oObj,fnCallback) {
    var oSelf = this;
    if (!oObj.getKey() || (hOpts && hOpts.sDestination == 'MySql') || oSelf.hOpts[oObj.getSettings().sDbAlias||'default'].bSkip || oObj.getSettings().sSource == 'MySql')
        fnCallback(null,oObj);
    else
        oSelf.acquire(function(err,oClient){
            if (err)
                oSelf.dispatchResult(err,oObj,fnCallback);
            else {
                var nTTL = (hOpts && hOpts.nTTL) ? hOpts.nTTL : oObj.getSettings().nTTL;
                var sKey = (hOpts && hOpts.sKey) ? hOpts.sKey : oObj.getClass()+':'+oObj.getKey();
                sKey = oClient.sHashKey+sKey;
                var multi = oClient.multi();

                //console.log('Store to Redis ('+oObj.sClass+'): '+sKey,nTTL);
                // Delete the key from Redis first. Otherwise, you won't ever be able to remove anything from an object's hData.
                multi.del(sKey);
                // We only store what's in hData. Any extra properties are saved automatically when calling setExtra.
                multi.hmset(sKey,oObj.hData);

                // If the object doesn't need to live on in Redis forever you can set it to expire.
                if (nTTL)
                    multi.expire(sKey,nTTL);

                // If the object definition includes anything in aSecondaryLookupKeys, then
                // the app needs to be able to lookup the object with that value. Store a pointer there.
                if (oObj.getSettings().aSecondaryLookupKeys) {
                    for (var i = 0; i < oObj.getSettings().aSecondaryLookupKeys.length; i++) {
                        if (oObj.get(oObj.getSettings().aSecondaryLookupKeys[i])) {
                            multi.hset(oClient.sHashKey+'KEYS',oObj.getClass()+':'+oObj.get(oObj.getSettings().aSecondaryLookupKeys[i]),oClient.sHashKey+oObj.getClass()+':'+oObj.getKey());
                            // The object pointer must also be set to expire if the data it's pointing to is going to expire.
                            if (nTTL)
                                multi.expire(oClient.sHashKey+oObj.getClass()+':'+oObj.get(oObj.getSettings().aSecondaryLookupKeys[i]),nTTL);
                        }
                    }
                }

                multi.exec(function(err) {
                    oSelf.dispatchResult(err,oObj,fnCallback);
                });
            }
        },oObj.getSettings().sDbAlias);
};
/**
 * This method removes the item from Redis using its num key value.
 * @param oObj
 * @param fnCallback
 */
p.deleteObject = function(oObj,fnCallback){
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oObj,fnCallback);
        else {
            // Load the object's map so we can remove it from any extras it's attached to.
            oClient.hgetall(oClient.sHashKey+oObj.getClass()+':'+oObj.getKey()+':MAP',function(err,hMap) {
                var multi = oClient.multi();
                // Delete the source object.
                multi.del(oClient.sHashKey+oObj.getClass()+':'+oObj.getKey());
                multi.hdel(oClient.sHashKey+'KEYS',oObj.getClass()+':'+oObj.getKey());
                // And its related, secondary lookup keys.
                if (oObj.getSettings().aSecondaryLookupKeys) {
                    for (var i = 0; i < oObj.getSettings().aSecondaryLookupKeys.length; i++) {
                        var sKey = oObj.get(oObj.getSettings().aSecondaryLookupKeys[i]);
                        if (sKey) multi.hdel(oClient.sHashKey+'KEYS',oObj.getClass()+':'+sKey);
                    }
                }
                // And its extras.
                if (oObj.getSettings().hExtras) {
                    for (var sProp in oObj.getSettings().hExtras) {
                        multi.del(oClient.sHashKey+oObj.getClass()+':'+oObj.getKey()+':'+sProp);
                    }
                }
                for (var sKey in hMap) {
                    multi.zrem(sKey,oClient.sHashKey+oObj.getClass()+':'+oObj.getKey());
                }
                multi.del(oClient.sHashKey+oObj.getClass()+':'+oObj.getKey()+':MAP');
                multi.exec(function(err){
                    oSelf.dispatchResult(err,oObj,fnCallback);
                });
            });

        }
    },oObj.getSettings().sDbAlias);
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
    if (oSelf.hOpts[oObj.getSettings().sDbAlias||'default'].bSkip)
        oSelf.dispatchResult(null,oObj,fnCallback);
    else
        oSelf.acquire(function(err,oClient){
            if (err)
                oSelf.dispatchResult(err,oObj,fnCallback);
            else {
                if (hOpts && hOpts.sKey) {
                    var sOrderBy = (hOpts.sOrderBy) ? hOpts.sOrderBy : 'nCreated';
                    var nScore = oObj.get(sOrderBy);
                    // If the sorting value is a string, convert it to a number.
                    if (oObj.getSettings() && oObj.getSettings().hProperties && oObj.getSettings().hProperties[sOrderBy] && oObj.getSettings().hProperties[sOrderBy].sType == 'String') {
                        var nScore = 0;
                        var n = 3;
                        var letters = oObj.get(sOrderBy).toLowerCase().split('');
                        for (var i = 0; i < 4; i++) {
                            if (letters[i]) {
                                var byte = letters[i].charCodeAt(0);
                                nScore += byte * Math.pow(256, n);
                                n--;
                            }
                        }
                        oObj.nScore = nScore;
                        //console.log(oObj.get(sOrderBy)+': '+nScore);
                    } else if (!oObj.getSettings() || !oObj.getSettings().hProperties)
                        Config.warn('Missing hProperties', oObj);
                    else if (!oObj.getSettings().hProperties[sOrderBy])
                        Config.warn('sOrderBy ('+sOrderBy+') does not exist on class '+oObj.sClass);

                    var nTTL = (hOpts.nTTL) ? hOpts.nTTL : oObj.getSettings().nTTL;

                    var multi = oClient.multi();
                    multi.zrem(oClient.sHashKey+hOpts.sKey,[oClient.sHashKey+oObj.getClass()+':'+oObj.getKey()]);
                    multi.zadd(oClient.sHashKey+hOpts.sKey,nScore,[oClient.sHashKey+oObj.getClass()+':'+oObj.getKey()]);
                    // Add reference to object map for clean-up later.
                    multi.hset(oClient.sHashKey+oObj.getClass()+':'+oObj.getKey()+':MAP',oClient.sHashKey+hOpts.sKey,1);
                    if (nTTL)
                        multi.expire(oClient.sHashKey+hOpts.sKey,nTTL); // in seconds

                    multi.exec(function(err){
                        if (err) {
                            Config.error(err);
                            console.log(oClient.sHashKey+hOpts.sKey+','+nScore);
                        }
                        oSelf.dispatchResult(err,oObj,fnCallback);
                    });

                } else
                    oSelf.dispatchResult('sKey missing.',oObj,fnCallback);
            }
        },oObj.getSettings().sDbAlias);
};
/**
 * Removes item from a sorted set.
 * @param hOpts
 * @param oObj
 * @param fnCallback
 */
p.removeFromSet = function(hOpts,oObj,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oObj,fnCallback);
        else {
            if (hOpts && hOpts.sKey) {
                oClient.zrem(oClient.sHashKey+hOpts.sKey,[oClient.sHashKey+oObj.getClass()+':'+oObj.getKey()]);
                // Add reference to object map for clean-up later.
                oClient.hdel(oClient.sHashKey+oObj.getClass()+':'+oObj.getKey()+':MAP',oClient.sHashKey+hOpts.sKey);
                oSelf.dispatchResult(err,oObj,fnCallback);
            } else
                oSelf.dispatchResult('sKey missing.',oObj,fnCallback);
        }
    },oObj.getSettings().sDbAlias);
};

/**
 * When objects are removed, often they are referenced in one or more sorted sets.
 * When we come across these we need to clean up the collections.
 * @param sKeys
 * @param fnCallback
 */
p.cleanSet = function(aKeys,fnCallback){
    var oSelf = this;

    async.forEachLimit(aKeys,1,function(sKey,callback) {
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
    },fnCallback);
};
/**
 * This method is used for increment values in redis, a quick and thread-safe way to count things.
 * @param hOpts
 * @param nValue
 * @param fnCallback
 */
p.increment = function(hOpts,nValue,fnCallback) {
    var oSelf = this;
    if (hOpts && hOpts.oObj && hOpts.sProperty) {
        oSelf.acquire(function(err,oClient){
            if (err)
                oSelf.dispatchResult(err,null,fnCallback);
            else {
                var sKey = oClient.sHashKey+hOpts.oObj.getClass()+':'+hOpts.oObj.getKey()+':'+hOpts.sProperty;

                if (hOpts.nTTL) {

                    oClient.incrby(sKey,nValue,function(err,aResult){
                        if (!err && hOpts.nTTL) oClient.expire(sKey,hOpts.nTTL); // in seconds
                        oSelf.dispatchResult(err,aResult[0],fnCallback);
                    });

                } else
                    oClient.incrby(sKey,nValue,function(err,res){
                        oSelf.dispatchResult(err,res,fnCallback);
                    });
            }
        },hOpts.oObj.getSettings().sDbAlias);
    } else
        oSelf.dispatchResult('oObj or sProperty missing.',null,fnCallback);
};
/**
 * We use Redis to hand out primary key id values for every object in the system.
 * The Config singleton stores whether we've seeded the environment with the first
 * ID, which is set in global config under nSeedID.
 * @param oObj
 * @param fnCallback
 * @param sDbAlias
 */
p.getNextID = function(oObj,fnCallback,sDbAlias) {
    var oSelf = this;
    // This is a top-priority item.
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else {
            if (!oSelf.bSeeded) {
                if (!Config.nSeedID) Config.nSeedID = 100000; // Start primary key ids at 100,000.
                oClient.setnx(oClient.sHashKey+'nSeedID',Config.nSeedID);
            }
            oClient.incrby(oClient.sHashKey+'nSeedID',1,function(err,nID){
                if (!err && nID)
                    oObj.hData[oObj.getSettings().sKeyProperty] = nID;
                oSelf.dispatchResult(err,nID,fnCallback);
            });
        }
    },sDbAlias); // For now, the seed id (primary key id distribution) lives in the default redis db.
};
/**
 * http://redis.io/commands/publish
 * @param sKey
 * @param sValue
 * @param fnCallback
 * @param sDbAlias
 */
p.publish = function(sKey,sValue,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquirePub(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else
            oClient.publish(oClient.sHashKey+sKey,sValue,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
    },sDbAlias);
};
/**
 * http://redis.io/commands/rpush
 * @param sKey
 * @param sValue
 * @param fnCallback
 * @param sDbAlias
 */
p.rpush = function(sKey,sValue,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else {
            oClient.rpush(oClient.sHashKey+sKey,sValue,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
    },sDbAlias);
};

p.blpop = function(sKey1,sKey2,nTimeout,fnCallback,sDbAlias) {
    var oSelf = this;
    sDbAlias = (oSelf.hOpts[sDbAlias]) ? sDbAlias : 'default';
    oSelf.createClient(null,sDbAlias,function(err,oClient){
        if (err)
            fnCallback(err);
        else
            oClient.blpop(oSelf[sDbAlias].sHashKey+sKey1,oSelf[sDbAlias].sHashKey+sKey2,nTimeout,function(err,res){
                oClient.quit();
                if (err) console.error(err);
                fnCallback(err,res);
            });
    });
};

p.blpop3 = function(sKey1,sKey2,sKey3,nTimeout,fnCallback,sDbAlias) {
    var oSelf = this;
    sDbAlias = (oSelf.hOpts[sDbAlias]) ? sDbAlias : 'default';
    oSelf.createClient(null,sDbAlias,function(err,oClient) {
        if (err)
            fnCallback(err);
        else
            oClient.blpop(oSelf[sDbAlias].sHashKey + sKey1, oSelf[sDbAlias].sHashKey + sKey2, oSelf[sDbAlias].sHashKey + sKey3, nTimeout, function (err, res) {
                oClient.quit();
                if (err)
                    console.error(err);
                fnCallback(err, res);
            });
    });
};

p.hincrby = function(Key,sName,nIncr,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else if (Key instanceof Array) {
            var multi = oClient.multi();
            Key.forEach(function(sKey){
                multi.hincrby(oClient.sHashKey+sKey,sName,nIncr);
            });
            multi.exec(function(err){
                oSelf.dispatchResult(err,null,fnCallback);
            });
        } else {
            oClient.hincrby(oClient.sHashKey+Key,sName,nIncr,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
    },sDbAlias);
};

p.hincrmulti = function(Key,aNames,nIncr,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else {
            var multi = oClient.multi();
            aNames.forEach(function(sName){
                multi.hincrby(oClient.sHashKey+Key,sName,nIncr);
            });
            multi.exec(function(err){
                oSelf.dispatchResult(err,null,fnCallback);
            });
        }
    },sDbAlias);
};

p.hgetall = function(sKey,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else
            oClient.hgetall(oClient.sHashKey+sKey,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
    },sDbAlias);
};

p.hmget = function(sKey,sField,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else
            oClient.hmget(oClient.sHashKey+sKey,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
    },sDbAlias);
};

p.hmset = function(sKey,hData,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else
            oClient.hmset(oClient.sHashKey+sKey,hData,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
    },sDbAlias);
};

p.incr = function(Key,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else if (Key instanceof Array) {
            Key.forEach(function(sKey){
                oClient.incr(oClient.sHashKey+sKey);
            });
            oSelf.dispatchResult(err,null,fnCallback);
        } else {
            oClient.incr(oClient.sHashKey+Key,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
    },sDbAlias);
};

p.incrby = function(Key,Value,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else if (Key instanceof Array) {
            var multi = oClient.multi();
            Key.forEach(function(sKey){
                multi.incrby(oClient.sHashKey+sKey,Value);
            });
            multi.exec(function(err){
                oSelf.dispatchResult(err,null,fnCallback);
            });
        } else {
            oClient.incrby(oClient.sHashKey+Key,Value,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
    },sDbAlias);
};

p.keys = function(sKey,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else {
            oClient.keys(oClient.sHashKey+sKey,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
    },sDbAlias);
};

p.hvals = function(sKey,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else {
            oClient.hvals(oClient.sHashKey+sKey,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
    },sDbAlias);
};

p.hkeys = function(sKey,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else {
            oClient.hkeys(oClient.sHashKey+sKey,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
    },sDbAlias);
};

p.del = function(sKey,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else {
            if (!sKey.match(/^{/)) sKey = oClient.sHashKey+sKey;
            oClient.del(sKey,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
    },sDbAlias);
};

p.hlen = function(sKey,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else {
            oClient.hlen(oClient.sHashKey+sKey,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
    },sDbAlias);
};

p.get = function(sKey,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else {
            oClient.get(oClient.sHashKey+sKey,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
    },sDbAlias);
};

p.zcount = function(sKey,nMin,nMax,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else {
            oClient.zcount(oClient.sHashKey+sKey,nMin,nMax,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
    },sDbAlias);
};

p.zcard = function(sKey,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else {
            oClient.zcard(oClient.sHashKey+sKey,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
    },sDbAlias);
};

p.zrem = function(sKey,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else {
            oClient.zcard(oClient.sHashKey+sKey,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
    },sDbAlias);
};

p.set = function(hOpts,sValue,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else {
            var multi = oClient.multi();
            multi.set(oClient.sHashKey+hOpts.sKey,sValue);
            if (hOpts.nTTL)
                multi.expire(oClient.sHashKey+hOpts.sKey,hOpts.nTTL);
            multi.exec(function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
    },sDbAlias);
};

/**
 * This method merges all sorted sets matching the passed-in keys. Used for news presentation.
 * @param hOpts
 * @param cColl
 * @param fnCallback
 */
p.zmerge = function(hOpts,cColl,fnCallback) {
    var oSelf = this;
    if (hOpts && hOpts.aKeys && hOpts.aKeys.length)
        oSelf.acquire(function (err, oClient) {
            if (err)
                oSelf.dispatchResult(err, null, fnCallback);
            else {
                var sTempId = hOpts.aKeys.join(':');
                var multi = oClient.multi();
                multi.zunionstore([sTempId, hOpts.aKeys.length].concat(hOpts.aKeys));
                multi.expire(sTempId,86400);
                multi.zcount(sTempId,0,7260818340000);

                cColl.nIndex = cColl.nIndex || 0;
                cColl.nSize = cColl.nSize || 0;

                var nItemIndex;
                if (hOpts.nFirstID) {
                    if (!Config) Config = require('./../../AppConfig');

                    multi.zrank(sTempId,Config.hClasses[cColl.sClass].nClass+':'+hOpts.nFirstID);
                    multi.exec(function(err,aResults){
                        if (err)
                            oSelf.dispatchResult(err,null,fnCallback);
                        else {
                            multi = oClient.multi();

                            cColl.nTotal = aResults[2];
                            nItemIndex = aResults[3];

                            if (hOpts.bReverse) {
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
                                                cColl.nNextID = aResults3[i][Config.hClasses[cColl.sClass].sKeyProperty];
                                            } else
                                                cColl.add(aResults3[i]);
                                        } else
                                            nMissing++;
                                    }

                                    if (nMissing > 0) {
                                        cColl.empty();
                                        oSelf.cleanSet(hOpts.aKeys,function(){
                                            oSelf.zmerge(hOpts.aKeys,cColl,fnCallback);
                                        });
                                    } else {
                                        oSelf.release(oClient);
                                        // Finally, we should have everything.
                                        if (cColl.nTotal) cColl.sSource = 'Redis';
                                        oSelf.dispatchResult(err,cColl,fnCallback);
                                    }
                                });
                            });
                        }
                    });


                } else {

                    if (hOpts.bReverse) {
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
                            oSelf.dispatchResult(err,oClient,fnCallback);
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
                                    if (aResults2[i] && aResults2[i]) {
                                        if (i == cColl.nSize && cColl.nSize > 0) {
                                            cColl.nNextID = aResults2[i][Config.hClasses[cColl.sClass].sKeyProperty];
                                        } else
                                            cColl.add(aResults2[i]);
                                    } else {
                                        nMissing++;
                                    }
                                }
                                if (nMissing > 0) {
                                    cColl.empty();
                                    oSelf.cleanSet(hOpts.aKeys,function(){
                                        oSelf.zmerge(hOpts.aKeys,cColl,fnCallback);
                                    });
                                } else {
                                    oSelf.release(oClient);
                                    if (cColl.nTotal) cColl.sSource = 'Redis';
                                    // Finally, we should have everything.
                                    oSelf.dispatchResult(err,cColl,fnCallback);
                                }
                            });
                        }
                    });
                }
            }
        });
    else
        fnCallback();
};

module.exports = new Redis();

