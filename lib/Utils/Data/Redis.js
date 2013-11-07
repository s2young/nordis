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
    this.hSettings = hOpts;
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
        App = require('./../../AppConfig');
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
        App = require('./../../AppConfig');
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
p.loadObject = function(hOpts,oObj,fnCallback) {
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
        if (hResult) {
            oObj.hData = hResult;
            oObj.sSource = 'Redis';
        }
        oSelf.dispatchResult(err,oClient,fnCallback);
    });
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

            if (oObj.hSettings().hExtras) {
                for (var sProp in oObj.hSettings().hExtras) {
                    if (oObj.hSettings().hExtras[sProp].aKey && oObj.get(oObj.hSettings().hExtras[sProp].aKey[0])) {
                        var sClass = (oObj.hSettings().hExtras[sProp].sClass) ? oObj.hSettings().hExtras[sProp].sClass : oObj.hSettings().hExtras[sProp].fnGetClass ? oObj.hSettings().hExtras[sProp].sClass(oObj,App) : null;
                        if (sClass) {
                            multi.hset(oObj.nClass+':'+oObj.get('nID')+':MAP',oObj.nClass+':'+oObj.get('nID')+':'+sProp,App.hClasses[sClass].nClass+':'+oObj.get(oObj.hSettings().hExtras[sProp].aKey[0]));
                            if (nTTL)
                                multi.expire(oObj.nClass+':'+oObj.get('nID')+':'+sProp,nTTL);
                        }
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
            // Load the object's map so we can remove it from any extras it's attached to.
            oClient.hgetall(oObj.nClass+':'+oObj.get('nID')+':MAP',function(err,hMap) {
                var multi = oClient.multi();
                multi.del(oObj.nClass+':'+oObj.get('nID'));
                if (oObj.hSettings().aSecondaryLookupKeys) {
                    for (var i = 0; i < oObj.hSettings().aSecondaryLookupKeys.length; i++) {
                        if (oObj.get(oObj.hSettings().aSecondaryLookupKeys[i])) {
                            multi.del(oObj.nClass+':'+oObj.get(oObj.hSettings().aSecondaryLookupKeys[i]));
                        }
                    }
                }
                if (hMap) {
                    for (var sKey in hMap) {
                        var aParts = sKey.split(':');
                        var nClass = aParts[0]; var nID = aParts[1]; var sProperty = aParts[2];
                        switch (sProperty.substring(0,1)) {
                            case 'c':
                                multi.zrem(sKey,oObj.nClass+':'+oObj.get('nID'));
                                break;
                        }
                    }
                }
                if (oObj.hSettings().hExtras) {
                    for (var sProp in oObj.hSettings().hExtras) {
                        multi.del(oObj.nClass+':'+oObj.get('nID')+':'+sProp);
                    }
                }
                // Delete the object's map too.
                multi.del(oObj.nClass+':'+oObj.get('nID')+':MAP');
                multi.exec(function(err,res){
                    oSelf.dispatchResult(err,oClient,fnCallback,res);
                });
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
                var sOrderBy = (hOpts.sOrderBy) ? hOpts.sOrderBy : 'nCreated';
                var nTTL = (hOpts.nTTL) ? hOpts.nTTL : oObj.hSettings().nTTL;
                var multi = oClient.multi();
                multi.zrem(hOpts.sKey,[oObj.nClass+':'+oObj.get('nID')]);
                multi.zadd(hOpts.sKey,oObj.get(sOrderBy),[oObj.nClass+':'+oObj.get('nID')]);
                // Add reference to object map for clean-up later.
                multi.hset(oObj.nClass+':'+oObj.get('nID')+':MAP',hOpts.sKey,1);
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
    if (hOpts && hOpts.oObj && hOpts.sProperty) {
        oSelf.acquire(function(err,oClient){
            if (err)
                oSelf.dispatchResult(err,oClient,fnCallback);
            else {
                var sKey = hOpts.oObj.nClass+':'+hOpts.oObj.get('nID')+':'+hOpts.sProperty;

                if (hOpts.nTTL) {
                    var multi = oClient.multi();
                    multi.incrby(sKey,nValue);
                    if (hOpts.nTTL)
                        multi.expire(sKey,hOpts.nTTL); // in seconds
                    multi.exec(function(err,aResult){
                        oSelf.dispatchResult(err,oClient,fnCallback,aResult[0]);
                    });
                } else
                    oClient.incrby(sKey,nValue,function(err,res){
                        oSelf.dispatchResult(err,oClient,fnCallback,res);
                    });
            }
        });
    } else
        oSelf.dispatchResult('oObj or sProperty missing.',oClient,fnCallback);
};
/**
 * Updates object MAP with pointers to the IDs of an object's extras.
 * @param hOpts
 * @param Value
 * @param fnCallback
 */
p.setMap = function(hOpts,Value,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else if (hOpts.sKey) {
            if (!Base)
                Base = require('./../../Base');

            // Added this here because mysql doesn't care about the nClass.
            if (Value instanceof Base) {
                var multi = oClient.multi();
                multi.hset(Value.nClass+':'+Value.get('nID')+':MAP',hOpts.sKey,Value.nClass+':'+Value.get('nID'));
                if (hOpts.nTTL)
                    multi.expire(Value.nClass+':'+Value.get('nID')+':MAP',hOpts.nTTL);
                multi.exec(function(err){
                    oSelf.dispatchResult(err,oClient,fnCallback,Value);
                });
            } else
                oSelf.dispatchResult('Value provided must be a Base object.',oClient,fnCallback);
        } else
            oSelf.dispatchResult('No sKey provided.',oClient,fnCallback);
    });
};
/**
 * We use Redis to hand out primary key id values for every object in the system.
 * The App singleton stores whether we've seeded the environment with the first
 * ID, which is set in global config under nSeedID.
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
                multi.setnx('nSeedID',App.nSeedID);
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

module.exports = new Redis();

