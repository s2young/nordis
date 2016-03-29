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

p.createClient = function(sPool,sDbAlias,fnCallback,bForce){
    var oSelf = this;
    if (oSelf.hOpts[sDbAlias].sPassword) oSelf.opts.auth_pass = oSelf.hOpts[sDbAlias].sPassword;
    if (oSelf.hOpts[sDbAlias].nRetries == undefined) oSelf.hOpts[sDbAlias].nRetries = 0;

    if (oSelf.hOpts[sDbAlias].bSkip && !bForce && !sPool.match(/dbSubPool/)) {
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
p.acquire = function(fnCallback,sDbAlias,bForce) {
    var oSelf = this;
    sDbAlias = (oSelf.hOpts[sDbAlias]) ? sDbAlias : 'default';
    if (!oSelf.dbPool || !oSelf.dbPool[sDbAlias])
        oSelf.createClient('dbPool',sDbAlias,function(err,oClient){
            if (err || !oClient) {
                console.error(err||'No client found for '+sDbAlias);
                fnCallback(err);
            } else
                fnCallback(null,oClient);
        },bForce);
    else
        fnCallback(null, oSelf.dbPool[sDbAlias]);
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
    if (err && err instanceof Array && err[0].toString().match('maxmemory')) {
        Config.fatal('Redis is out of memory!');
    }

    if (fnCallback && fnCallback instanceof Function) {
        try {
            fnCallback(err,oResult);
        } catch (er) {
            console.log(er,(oResult && oResult.getKey()) ? oResult.sClass+': '+oResult.getKey() : '');
        }
    }
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

    if (bSkip) {
        delete oObj.sSource;
        oSelf.dispatchResult(null,null,fnCallback);
    } else
        oSelf.acquire(function(err,oClient){
            if (err||!oClient)
                oSelf.dispatchResult(err||'No connection.',oObj,fnCallback);
            else {
                if (hOpts.hQuery[sKeyProperty]) {
                    // Primary key lookup. We can get the whole object because we know where to look
                    oClient.get(oClient.sHashKey+oObj.getRedisKey(hOpts.hQuery[sKeyProperty]),function(err,hResult){
                        if (hResult) {
                            oObj.hData = JSON.parse(hResult);
                            oObj.sSource = 'Redis';
                        }
                        oSelf.dispatchResult(err,oObj,fnCallback);
                    });
                } else {
                    var sKey;
                    // Secondary lookup, which is just a pointer to the primary key.
                    if (hOpts.hQuery) {
                        for (var sLookup in hOpts.hQuery) {
                            // If only one is passed in, we assume it's an attempt to lookup by a secondary key. Otherwise, we skip redis altogether.
                            if (hOpts.hQuery[sLookup] && oObj.getSettings().hProperties && oObj.getSettings().hProperties[sLookup] && (oObj.getSettings().hProperties[sLookup].bPrimary || oObj.getSettings().hProperties[sLookup].bUnique)) {
                                sKey = oObj.getClass()+':'+hOpts.hQuery[sLookup];
                                break;
                            }
                        }
                    }

                    if (sKey) {
                        //Config.trace(oObj.sID,{Redis:{sID:oClient.sID},hQuery:hOpts.hQuery,sKey:sKey});
                        oClient.hget(oClient.sHashKey+'KEYS',sKey,function(err,res){
                            if (err || !res)
                                oSelf.dispatchResult(err,oObj,fnCallback);
                            else {
                                oClient.get(oClient.sHashKey+res,function(err,hResult){
                                    if (hResult) {
                                        oObj.hData = JSON.parse(hResult);
                                        oObj.sSource = 'Redis';
                                    }
                                    oSelf.dispatchResult(err,oObj,fnCallback);
                                });
                            }
                        });
                    } else
                        oSelf.dispatchResult(null,oObj,fnCallback);
                }
            }
        },sDbAlias);

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
                    function(callback) {
                        oClient.hget(oClient.sHashKey+oObj.getRedisKey(null,true)+':STATUS',hOpts.sKey,function(err,res){
                            //console.log(oClient.sHashKey+oObj.getRedisKey(null,true)+':STATUS,'+hOpts.sKey+','+res);
                            if (err || !res) {
                                oObj.nTotal = 0;
                                callback('skip');
                            } else {
                                oObj.sSource = 'Redis';
                                callback(null,null);
                            }
                        });
                    }
                    ,function(res,callback){
                        if (hOpts && (hOpts.nMin || hOpts.nMax)) {
                            hOpts.nMin = (hOpts.nMin) ? parseFloat(hOpts.nMin) : 0;
                            hOpts.nMax = (hOpts.nMax) ? parseFloat(hOpts.nMax) : 2147483647000;
                            if (oObj.bReverse)
                                oClient.zrevrangebyscore(oClient.sHashKey+hOpts.sKey,hOpts.nMin,hOpts.nMax,callback);
                            else
                                oClient.zrangebyscore(oClient.sHashKey+hOpts.sKey,hOpts.nMin,hOpts.nMax,callback);
                        } else
                            oClient.zcard(oClient.sHashKey+hOpts.sKey,callback);
                    }
                    ,function(res,callback){
                        oObj.nTotal = (res instanceof Array) ? res.length : res;

                        if (!oObj.nTotal)
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
                                        oClient.zrevrank(oClient.sHashKey+hOpts.sKey,oClient.sHashKey+oObj.getRedisKey(oObj.sFirstID),cb);
                                    else
                                        oClient.zrank(oClient.sHashKey+hOpts.sKey,oClient.sHashKey+oObj.getRedisKey(oObj.sFirstID),cb);
                                }
                                ,function(nStart,cb){
                                    // The sorted set only has pointers, so we must load the individual items in the collection.
                                    var handleResult = function(err,aResult) {
                                        delete oObj.nStart;
                                        delete oObj.nEnd;
                                        delete oObj.bReverse;

                                        // Every page is a fresh start. We don't append page after page.
                                        oObj.aObjects = [];

                                        // If we have a size limit, lop off the last item before processing.
                                        if (oObj.nSize && aResult && aResult[oObj.nSize]) {
                                            var aParts = aResult[oObj.nSize].toString().split(':');
                                            oObj.nNextID = aParts[aParts.length-1];
                                            aResult.splice(-1,1);
                                            oObj.nCount = aResult.length;
                                        } else if (aResult)
                                            oObj.nCount = aResult.length;

                                        if (aResult) {

                                            oClient.mget(aResult,function(err,aItems){
                                                if (err || !aItems || !aItems.length)
                                                    cb(err);
                                                else
                                                    async.forEachOfLimit(aItems,100,function(hData,ind,cb2){
                                                        hData = (hData) ? JSON.parse(hData) : null;
                                                        if (!hData) {

                                                            oObj.nTotal--;
                                                            oClient.zrem(oClient.sHashKey+hOpts.sKey,aResult[n],cb2);

                                                        } else if (!hOpts.nSize || oObj.aObjects.length < hOpts.nSize) {

                                                            var oItem = oObj.add(hData,true);
                                                            if (hOpts && hOpts.hExtras)
                                                                oItem.loadExtras(hOpts.hExtras, cb2);
                                                            else
                                                                cb2();

                                                        } else {
                                                            if (!Base) Base = require('./../../Base');
                                                            var oItem = Base.cast(hData,oObj.sClass);
                                                            oObj.sFirstID = oItem.getKey();
                                                            cb2();
                                                        }

                                                    },cb);

                                            });
                                        } else
                                            cb();
                                    };

                                    if (!oObj.sFirstID && res.length)
                                        handleResult(null,res);
                                    else {
                                        oObj.nStart = parseFloat(nStart) || 0;
                                        oObj.nEnd = (oObj.nSize) ? (oObj.nStart+oObj.nSize+1) : -1;
                                        delete oObj.sFirstID;

                                        if (oObj.bReverse)
                                            oClient.zrevrange(oClient.sHashKey+hOpts.sKey,oObj.nStart,oObj.nEnd,handleResult);
                                        else
                                            oClient.zrange(oClient.sHashKey+hOpts.sKey,oObj.nStart,oObj.nEnd,handleResult);

                                    }
                                }
                            ],callback);
                        }
                    }

                ],function(err) {
                    if (err=='skip') err = null;
                    fnCallback(err);
                });
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
                var sKey = (hOpts && hOpts.sKey) ? hOpts.sKey : oObj.getRedisKey();
                sKey = oClient.sHashKey+sKey;

                oClient.del(sKey);
                oClient.set(sKey,JSON.stringify(oObj.hData));
                if (nTTL) oClient.expire(sKey,nTTL,cb);
                if (oObj.getSettings().aSecondaryLookupKeys)
                    oObj.getSettings().aSecondaryLookupKeys.forEach(function(sProp){
                        if (oObj.get(sProp)) oClient.hset(oClient.sHashKey+'KEYS',oObj.getClass()+':'+oObj.get(sProp),oObj.getRedisKey());
                    });

                oSelf.dispatchResult(null,oObj,fnCallback);
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
            oClient.hgetall(oClient.sHashKey+oObj.getRedisKey()+':MAP',function(err,hMap) {
                // Delete the source object.
                oClient.del(oClient.sHashKey+oObj.getRedisKey());
                oClient.hdel(oClient.sHashKey+'KEYS',oObj.getRedisKey());
                // And its related, secondary lookup keys.
                if (oObj.getSettings().aSecondaryLookupKeys) {
                    for (var i = 0; i < oObj.getSettings().aSecondaryLookupKeys.length; i++) {
                        var sKey = oObj.get(oObj.getSettings().aSecondaryLookupKeys[i]);
                        if (sKey) oClient.hdel(oClient.sHashKey+'KEYS',oObj.getClass()+':'+sKey);
                    }
                }
                // And its extras.
                if (oObj.getSettings().hExtras) {
                    for (var sProp in oObj.getSettings().hExtras) {
                        oClient.del(oClient.sHashKey+oObj.getRedisKey()+':'+sProp);
                    }
                }
                for (var sKey in hMap) {
                    oClient.zrem(sKey,oClient.sHashKey+oObj.getRedisKey());
                }
                oClient.del(oClient.sHashKey+oObj.getRedisKey()+':MAP');
                oSelf.dispatchResult(null,oObj,fnCallback);
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

                    oClient.zrem(oClient.sHashKey+hOpts.sKey,[oClient.sHashKey+oObj.getRedisKey()]);
                    oClient.zadd(oClient.sHashKey+hOpts.sKey,nScore,oClient.sHashKey+oObj.getRedisKey());
                    // Add reference to object map for clean-up later.
                    oClient.hset(oClient.sHashKey+oObj.getRedisKey()+':MAP',oClient.sHashKey+hOpts.sKey,1);

                    if (nTTL) oClient.expire(oClient.sHashKey+hOpts.sKey,nTTL); // in seconds

                    oSelf.dispatchResult(null,oObj,fnCallback);

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
                oClient.zrem(oClient.sHashKey+hOpts.sKey,[oClient.sHashKey+oObj.getRedisKey()]);
                // Add reference to object map for clean-up later.
                oClient.hdel(oClient.sHashKey+oObj.getRedisKey()+':MAP',oClient.sHashKey+hOpts.sKey);
                oSelf.dispatchResult(err,oObj,fnCallback);
            } else
                oSelf.dispatchResult('sKey missing.',oObj,fnCallback);
        }
    },oObj.getSettings().sDbAlias);
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
                var sKey = oClient.sHashKey+hOpts.oObj.getRedisKey()+':'+hOpts.sProperty;

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
    },sDbAlias,true); // For now, the seed id (primary key id distribution) lives in the default redis db.
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
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else {
            if (sValue instanceof Object) sValue = JSON.stringify(sValue);
            oClient.publish(sKey,sValue,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
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

p.llen = function(sKey,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else {
            oClient.llen(oClient.sHashKey+sKey,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
    },sDbAlias);
};

p.blpop1 = function(sKey1,nTimeout,fnCallback,sDbAlias) {
    var oSelf = this;
    sDbAlias = (oSelf.hOpts[sDbAlias]) ? sDbAlias : 'default';
    oSelf.createClient(null,sDbAlias,function(err,oClient){
        if (err)
            fnCallback(err);
        else
            oClient.blpop(oSelf[sDbAlias].sHashKey+sKey1,nTimeout,function(err,res){
                oClient.quit();
                if (err) console.error(err);
                fnCallback(err,res);
            });
    });
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

p.blpop2 = function(sKey1,sKey2,nTimeout,fnCallback,sDbAlias) {
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

p.blpop4 = function(sKey1,sKey2,sKey3,sKey4,nTimeout,fnCallback,sDbAlias) {
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

            async.forEachOfLimit(Key,10,function(sKey,ind,cb){
                oClient.hincrby(oClient.sHashKey+sKey,sName,nIncr,cb);
            },function(){
                oSelf.dispatchResult(null,null,fnCallback);
            });

        } else
            oClient.hincrby(oClient.sHashKey+Key,sName,nIncr,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });

    },sDbAlias);
};

p.hgetall = function(sKey,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err || !oClient)
            oSelf.dispatchResult(err,null,fnCallback);
        else
            oClient.hgetall(oClient.sHashKey+sKey,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
    },sDbAlias);
};

p.hdel = function(sKey,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err || !oClient)
            oSelf.dispatchResult(err,null,fnCallback);
        else
            oClient.hdel(oClient.sHashKey+sKey,function(err,res){
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
            oClient.hmget(oClient.sHashKey+sKey,sField,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
    },sDbAlias);
};

p.hget = function(sKey,sField,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else
            oClient.hget(oClient.sHashKey+sKey,sField,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
    },sDbAlias);
};

p.hset = function(sKey,sField,sValue,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else {
            //console.log('SET: '+oClient.sHashKey+sKey,sField);
            oClient.hset(oClient.sHashKey+sKey,sField,sValue,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
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
            Key.forEach(function(sKey){
                oClient.incrby(oClient.sHashKey+sKey,Value);
            });
            oSelf.dispatchResult(null,null,fnCallback);
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
            oClient.set(oClient.sHashKey+hOpts.sKey,sValue);
            if (hOpts.nTTL) oClient.expire(oClient.sHashKey+hOpts.sKey,hOpts.nTTL);
            oSelf.dispatchResult(null,null,fnCallback);
        }
    },sDbAlias);
};

module.exports = new Redis();

