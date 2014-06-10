var redis       = require('redis'),
    async       = require('async'),
    Str         = require('./../String');

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
};
p.acquire = function(fnCallback,sDbAlias) {
    var oSelf = this;
    sDbAlias = (oSelf.hOpts[sDbAlias]) ? sDbAlias : 'default';
    if (!oSelf.dbPool || !oSelf.dbPool[sDbAlias]) {
        if (!oSelf.dbPool) oSelf.dbPool = {};
        if (!Config) {
            Base = require('./../../Base');
            Config = require('./../../AppConfig');
        }
        oSelf.dbPool[sDbAlias] = redis.createClient(oSelf.hOpts[sDbAlias].nPort,oSelf.hOpts[sDbAlias].sHost,{});

        oSelf.dbPool[sDbAlias].sDbAlias = sDbAlias;
    }

    if (oSelf.hOpts[sDbAlias].nMaxMemory)
        oSelf.dbPool[sDbAlias].config('set','maxmemory',oSelf.hOpts[sDbAlias].nMaxMemory);
    if (oSelf.hOpts[sDbAlias].sMaxMemoryPolicy)
        oSelf.dbPool[sDbAlias].config('set','maxmemory-policy',oSelf.hOpts[sDbAlias].sMaxMemoryPolicy);

    if (oSelf.hOpts[sDbAlias].nDb && oSelf.dbPool[sDbAlias].selected_db != oSelf.hOpts[sDbAlias].nDb)
        oSelf.dbPool[sDbAlias].select(oSelf.hOpts[sDbAlias].nDb,function(){
            fnCallback(null,oSelf.dbPool[sDbAlias]);
        });
    else
        fnCallback(null,oSelf.dbPool[sDbAlias]);
};
p.release = function(oClient,oObj) {

};
p.releaseSub = function(oClient) {
    this.dbSubPool.release(oClient);
};
p.destroySub = function(oClient) {
    this.dbSubPool.destroy(oClient);
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
        oSelf.dbSubPool[sDbAlias] = redis.createClient(oSelf.hOpts[sDbAlias].nPort,oSelf.hOpts[sDbAlias].sHost,{});
//        oSelf.dbSubPool[sDbAlias].on("error", function (err) {
//            if (err) Config.fatal(err);
//        });
        oSelf.dbSubPool[sDbAlias].sDbAlias = sDbAlias;
    }
    if (oSelf.hOpts[sDbAlias].nDb && oSelf.dbSubPool[sDbAlias].selected_db != oSelf.hOpts[sDbAlias].nDb)
        oSelf.dbSubPool[sDbAlias].select(oSelf.hOpts[sDbAlias].nDb,function(){
            fnCallback(null,oSelf.dbSubPool[sDbAlias]);
        });
    else
        fnCallback(null,oSelf.dbSubPool[sDbAlias]);
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
        this.hOpts.bSkip = true;
    }
    if (fnCallback) fnCallback(err,oResult);
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
    var bSkip = (oSelf.hOpts[sDbAlias].bSkip||oObj.getKey()||hOpts.sSource=='MySql'||(hOpts.hQuery && hOpts.hQuery.sWhere));

    async.series([
        function(callback) {
            if (bSkip) {
                delete oObj.sSource;
                callback(null,null);
            } else
                oSelf.acquire(function(err,oResult){
                    oClient = oResult;

                    if (hOpts.hQuery[sKeyProperty]) {
                        Config.trace(oObj.sID,{Redis:{sID:oClient.sID},hQuery:hOpts.hQuery,sKey:oObj.getClass()+':'+hOpts.hQuery[sKeyProperty]});
                        // Primary key lookup. We can get the whole object because we know where to look
                        oClient.hgetall(oObj.getClass()+':'+hOpts.hQuery[sKeyProperty],function(err,hResult){
                            if (hResult) {
                                oObj.hData = hResult;
                                oObj.sSource = 'Redis';
                            }
                            callback(err);
                        });
                    } else {
                        var sKey;
                        // Secondary lookup, which is just a pointer to the primary key.
                        for (var sLookup in hOpts.hQuery) {
                            // If only one is passed in, we assume it's an attempt to lookup by a secondary key. Otherwise, we skip redis altogether.
                            if (oObj.getSettings() && oObj.getSettings().hProperties && oObj.getSettings().hProperties[sLookup] && (oObj.getSettings().hProperties[sLookup].bPrimary || oObj.getSettings().hProperties[sLookup].bUnique)) {
                                sKey = oObj.getClass()+':'+hOpts.hQuery[sLookup];
                                break;
                            }
                        }
                        if (sKey) {
                            //Config.trace(oObj.sID,{Redis:{sID:oClient.sID},hQuery:hOpts.hQuery,sKey:sKey});
                            oClient.get(sKey,function(err,res){
                                if (err || !res)
                                    callback(err,null);
                                else
                                    oClient.hgetall(res,function(err,hResult){
                                        if (hResult) {
                                            oObj.hData = hResult;
                                            oObj.sSource = 'Redis';
                                        }
                                        callback(err);
                                    });
                            });
                        } else
                            callback(null,null);
                    }
                },sDbAlias);
        }
        ,function(callback) {
            if (bSkip || !hOpts || !hOpts.hExtras)
                callback();
            else
                oObj.loadExtras(hOpts.hExtras,callback);
        }
    ],function(err){
        oSelf.dispatchResult(err,oObj,fnCallback);
    });
};

p.loadCollection = function(hOpts,oObj,fnCallback) {
    var oSelf = this;

    if (hOpts && hOpts.sSource == 'MySql' || (hOpts.hQuery && hOpts.hQuery.sWhere))
        fnCallback();
    else {
        var sDbAlias = (oSelf.hOpts[oObj.getSettings().sDbAlias]) ? oObj.getSettings().sDbAlias : 'default';
        async.waterfall([
            function(callback){
                if (hOpts && (hOpts.nMin || hOpts.nMax))
                    Config.Redis.zcount(hOpts.sKey,hOpts.nMin||0,hOpts.nMax||726081834000,callback);
                else
                    Config.Redis.zcard(hOpts.sKey,callback,sDbAlias);
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
                                Config.Redis.dbPool[sDbAlias].zrevrank(hOpts.sKey,oObj.getClass()+':'+oObj.sFirstID,cb);
                            else
                                Config.Redis.dbPool[sDbAlias].zrank(hOpts.sKey,oObj.getClass()+':'+oObj.sFirstID,cb);
                        }
                        ,function(nStart,cb){
                            oObj.nStart = oObj.toNumber(nStart);
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
                                if (oObj.nSize && aResult[oObj.nSize]) {
                                    oObj.nNextID = oObj.toNumber(aResult[oObj.nSize].toString().replace(/^[^:]*\:/,''));
                                    aResult.splice(-1,1);
                                    oObj.nCount = aResult.length;
                                } else
                                    oObj.nCount = aResult.length;

                                async.forEach(aResult,function(sItemKey,cback){
                                    Config.Redis.dbPool[sDbAlias].hgetall(sItemKey,function(err,res){
                                        if (err)
                                            cback(err);
                                        else if (!res) {
                                            Config.Redis.zrem(sItemKey);
                                            oObj.nCount--;
                                            oObj.nTotal--;
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
                                },cb);
                            };

                            if (oObj.bReverse)
                                Config.Redis.dbPool[sDbAlias].zrevrange(hOpts.sKey,oObj.nStart,oObj.nEnd,handleResult);
                            else
                                Config.Redis.dbPool[sDbAlias].zrange(hOpts.sKey,oObj.nStart,oObj.nEnd,handleResult);
                        }
                    ],callback);
                }
            }
        ],fnCallback);
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
    if (!oObj.getKey() || (hOpts && hOpts.sDestination == 'MySql'))
        fnCallback(null,oObj);
    else
        oSelf.acquire(function(err,oClient){
            if (err)
                oSelf.dispatchResult(err,oObj,fnCallback);
            else {
                var nTTL = (hOpts && hOpts.nTTL) ? hOpts.nTTL : oObj.getSettings().nTTL;
                var sKey = (hOpts && hOpts.sKey) ? hOpts.sKey : oObj.getClass()+':'+oObj.getKey();
                var multi = oClient.multi();

                Config.silly('Store to Redis: '+sKey);
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
                            multi.set(oObj.getClass()+':'+oObj.get(oObj.getSettings().aSecondaryLookupKeys[i]),oObj.getClass()+':'+oObj.getKey());
                            // The object pointer must also be set to expire if the data it's pointing to is going to expire.
                            if (nTTL)
                                multi.expire(oObj.getClass()+':'+oObj.get(oObj.getSettings().aSecondaryLookupKeys[i]),nTTL);
                        }
                    }
                }

                if (oObj.getSettings().hExtras) {
                    for (var sProp in oObj.getSettings().hExtras) {
                        if (oObj.getSettings().hExtras[sProp].aKey && oObj.get(oObj.getSettings().hExtras[sProp].aKey[0])) {
                            var sClass = oObj.getSettings().hExtras[sProp].sClass;
                            if (sClass) {
                                multi.hset(oObj.getClass()+':'+oObj.getKey()+':MAP',oObj.getClass()+':'+oObj.getKey()+':'+sProp,Config.getClasses(sClass).nClass+':'+oObj.get(oObj.getSettings().hExtras[sProp].aKey[0]));
                                if (nTTL)
                                    multi.expire(oObj.getClass()+':'+oObj.getKey()+':'+sProp,nTTL);
                            }
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
            oClient.hgetall(oObj.getClass()+':'+oObj.getKey()+':MAP',function(err,hMap) {
                oClient.del(oObj.getClass()+':'+oObj.getKey());
                if (oObj.getSettings().aSecondaryLookupKeys) {
                    for (var i = 0; i < oObj.getSettings().aSecondaryLookupKeys.length; i++) {
                        if (oObj.get(oObj.getSettings().aSecondaryLookupKeys[i])) {
                            oClient.del(oObj.getClass()+':'+oObj.get(oObj.getSettings().aSecondaryLookupKeys[i]));
                        }
                    }
                }
                if (hMap) {
                    for (var sKey in hMap) {
                        oClient.zrem(sKey,oObj.getClass()+':'+oObj.getKey());
                    }
                }
                if (oObj.getSettings().hExtras) {
                    for (var sProp in oObj.getSettings().hExtras) {
                        oClient.del(oObj.getClass()+':'+oObj.getKey()+':'+sProp);
                    }
                }
                // Delete the object's map too.
                oClient.del(oObj.getClass()+':'+oObj.getKey()+':MAP');
                oSelf.dispatchResult(err,oObj,fnCallback);
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
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oObj,fnCallback);
        else {
            if (hOpts && hOpts.sKey) {
                var sOrderBy = (hOpts.sOrderBy) ? hOpts.sOrderBy : 'nCreated';
                var nScore = oObj.get(sOrderBy);
                // If the sorting value is a string, convert it to a number.
                if (oObj.getSettings().hProperties[sOrderBy].sType == 'String') {
                    var nScore = 0;
                    var n = 3;
                    var letters = oObj.get(sOrderBy).toLowerCase().split('');
                    for (var i = 0; i < 4; i++) {
                        if (letters[i]) {
                            var byte = letters[i].charCodeAt(0);
                            nScore += byte * Math.pow(256,n);
                            n--;
                        }
                    }
                    //console.log(oObj.get(sOrderBy)+': '+nScore);
                }

                var nTTL = (hOpts.nTTL) ? hOpts.nTTL : oObj.getSettings().nTTL;
                oClient.zrem(hOpts.sKey,[oObj.getClass()+':'+oObj.getKey()]);
                oClient.zadd(hOpts.sKey,nScore,[oObj.getClass()+':'+oObj.getKey()]);
                // Add reference to object map for clean-up later.
                oClient.hset(oObj.getClass()+':'+oObj.getKey()+':MAP',hOpts.sKey,1);
                if (nTTL)
                    oClient.expire(hOpts.sKey,nTTL); // in seconds

                oSelf.dispatchResult(err,oObj,fnCallback);
            } else
                oSelf.dispatchResult('sKey missing.',oObj,fnCallback);
        }
    },oObj.getSettings().sDbAlias);
};

p.removeFromSet = function(hOpts,oObj,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oObj,fnCallback);
        else {
            if (hOpts && hOpts.sKey) {
                oClient.zrem(hOpts.sKey,[oObj.getClass()+':'+oObj.getKey()]);
                // Add reference to object map for clean-up later.
                oClient.hdel(oObj.getClass()+':'+oObj.getKey()+':MAP',hOpts.sKey,1);
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
                var sKey = hOpts.oObj.getClass()+':'+hOpts.oObj.getKey()+':'+hOpts.sProperty;

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
 * Updates object MAP with pointers to the IDs of an object's extras.
 * @param hOpts
 * @param Value
 * @param fnCallback
 */
p.setMap = function(hOpts,Value,fnCallback) {
    var oSelf = this;

    if ((Value instanceof Base)===false) {
        oSelf.dispatchResult('Value provided must be a Base object.',null,fnCallback);
    } if (!hOpts.sKey) {
        oSelf.dispatchResult('No sKey provided.',null,fnCallback);
    } else
        oSelf.acquire(function(err,oClient){
            if (err)
                oSelf.dispatchResult(err,null,fnCallback);
            else {
                if (!Base) Base = require('./../../Base');

                // Added this here because mysql doesn't care about the nClass.
                oClient.hset(Value.getClass()+':'+Value.getKey()+':MAP',hOpts.sKey,Value.nClass+':'+Value.getKey(),function(err){
                    if (!err && hOpts.nTTL) oClient.expire(Value.getClass()+':'+Value.getKey()+':MAP',hOpts.nTTL);
                    oSelf.dispatchResult(err,Value,fnCallback);
                });
            }
        },Value.getSettings().sDbAlias);
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
                oClient.setnx('nSeedID',Config.nSeedID);
            }
            oClient.incrby('nSeedID',1,function(err,nID){
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
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else
            oClient.publish(sKey,sValue,function(err,res){
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
            oClient.rpush(sKey,sValue,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
    },sDbAlias);
};

p.blpop = function(sKey1,sKey2,nTimeout,fnCallback,sDbAlias) {
    var oSelf = this;
    sDbAlias = (oSelf.hOpts[sDbAlias]) ? sDbAlias : 'default';

    var oClient = redis.createClient(oSelf.hOpts[sDbAlias].nPort,oSelf.hOpts[sDbAlias].sHost,{});

    if (oSelf.hOpts[sDbAlias].nDb && oClient.selected_db != oSelf.hOpts[sDbAlias].nDb)
        oClient.select(oSelf.hOpts[sDbAlias].nDb);

    oClient.blpop(sKey1,sKey2,nTimeout,function(err,res){
        oClient.quit();
        fnCallback(err,res);
    });
};

p.hincrby = function(Key,sName,nIncr,fnCallback,sDbAlias) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,null,fnCallback);
        else if (Key instanceof Array) {
            Key.forEach(function(sKey){
                oClient.hincrby(sKey,sName,nIncr);
            });
            oSelf.dispatchResult(err,null,fnCallback);
        } else {
            oClient.hincrby(Key,sName,nIncr,function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
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
            oClient.hgetall(sKey,function(err,res){
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
                oClient.incr(sKey);
            });
            oSelf.dispatchResult(err,null,fnCallback);
        } else {
            oClient.incr(Key,function(err,res){
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
                oClient.incrby(sKey,Value);
            });
            oSelf.dispatchResult(err,null,fnCallback);
        } else {
            oClient.incrby(Key,Value,function(err,res){
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
            oClient.keys(sKey,function(err,res){
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
            oClient.hlen(sKey,function(err,res){
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
            oClient.get(sKey,function(err,res){
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
            oClient.zcount(sKey,nMin,nMax,function(err,res){
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
            oClient.zcard(sKey,function(err,res){
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
            oClient.zcard(sKey,function(err,res){
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
            multi.set(hOpts.sKey,sValue);
            if (hOpts.nTTL)
                multi.expire(hOpts.sKey,hOpts.nTTL);
            multi.exec(function(err,res){
                oSelf.dispatchResult(err,res,fnCallback);
            });
        }
    },sDbAlias);
};

/**
 * This method merges all sorted sets matching the passed-in keys. Used for news presentation.
 * @param aKeys
 * @param cColl
 * @param fnCallback
 */
p.zmerge = function(aKeys,cColl,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function (err, oClient) {
        if (err)
            oSelf.dispatchResult(err, null, fnCallback);
        else {
            var sTempId = aKeys.join(':');
            var multi = oClient.multi();
            multi.zunionstore([sTempId, aKeys.length].concat(aKeys));
            multi.expire(sTempId,86400);
            multi.zcount(sTempId,0,7260818340000);

            cColl.nIndex = cColl.nIndex || 0;
            cColl.nSize = cColl.nSize || 0;

            var nItemIndex;
            if (cColl.nFirstID) {
                multi.zrank(sTempId,App.nClass_News+':'+cColl.nFirstID);
                multi.exec(function(err,aResults){
                    if (err)
                        oSelf.dispatchResult(err,null,fnCallback);
                    else {
                        multi = oClient.multi();

                        cColl.nTotal = aResults[2];
                        nItemIndex = aResults[3];

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
                                    oSelf.dispatchResult(err,cColl,fnCallback);
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
                                oSelf.dispatchResult(err,cColl,fnCallback);
                            }
                        });
                    }
                });
            }
        }
    });
};

module.exports = new Redis();

