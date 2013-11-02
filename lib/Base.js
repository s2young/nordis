var util    = require('util'),
    fs      = require('fs'),
    events  = require('events'),
    sanitize= require('validator').sanitize,
    check   = require('validator').check,
    App     = require('./AppConfig'),
    String  = require('./Utils/String'),
    REST    = require('./Utils/Data/REST'),
    async   = require('async');

var Collection;
function Base(hOpts,fnCallback){
    var oSelf = this;
    oSelf.hData = {};
    // Set data source for the object.
    if (hOpts) {
        if (hOpts.sClass) {
            oSelf.sClass = hOpts.sClass;
            oSelf.nClass = App.hClasses[oSelf.sClass].nClass;
        } else if (hOpts.nClass) {
            oSelf.nClass = hOpts.nClass;
            oSelf.sClass = App.hClassMap[oSelf.nClass].sClass;
        }
        if (!oSelf.nClass && !oSelf.sClass) {
            throw('Must supply either nClass or sClass to create an object, and set classes properly in configuration. '+JSON.stringify(hOpts));
        }

        // The hQuery tells us to try looking up the object.
        if (hOpts.hQuery) {
            if (fnCallback) {
                async.waterfall([
                    function(callback) {
                        if (App.Redis && !App.Redis.hSettings.bSkip && (!hOpts || (hOpts.sSource != 'MySql' && !hOpts.hQuery.sWhere))) {
                            App.Redis.load(hOpts,oSelf,function(err){
                                if(oSelf && oSelf.get('nID')) oSelf.sSource = 'Redis'
                                callback(err,oSelf);
                            });
                        } else
                            callback(null,null);
                    }
                    ,function(oObj,callback) {
                        if (!App.MySql.hSettings.bSkip && (!oSelf.get('nID') || (hOpts && hOpts.sSource=='MySql'))) {
                            App.MySql.load(hOpts,oSelf,callback);
                        } else
                            callback(null,oSelf);
                    }
                    ,function(oObj,callback) {
                        if (hOpts && hOpts.hExtras)
                            oSelf.loadExtras(hOpts.hExtras,callback);
                        else
                            callback(null,oSelf);
                    }
                ],fnCallback);
            } else
                delete hOpts.hQuery;
        } else if (hOpts instanceof Base) {
            oSelf.copyData(hOpts);
        } else if (hOpts.hData) {
            oSelf.setData(hOpts,true);
        } else {
            for (var sKey in hOpts) {
                if (hOpts[sKey] != undefined) {
                    oSelf[sKey] = hOpts[sKey];
                }
            }
        }
    }
}
util.inherits(Base, events.EventEmitter);

var p = Base.prototype;

p.aExceptions = null;
p.aEvents = null;
p.sClass = '';

/**
 * Used for after-initial-object-load lookup of properties on the object.
 * @param hExtras
 * @param fnCallback
 */
p.loadExtras = function(hExtras,fnCallback) {
    var oSelf = this;

    // Store the queries and connection we need to execute as much in a single transaction as possible.
    var oRedisClient;
    var oMySqlClient;

    // Used to load data into the extra, recursively as instructed in the hExtras directive.
    var loadExtra = function(hOpts,callback){

        var oRedisMulti; // Placeholder for a multi-exec query to pull first-level data.
        var oRedisSubMulti; // Placeholder for multi-exec query to pull second-level data, if needed.
        var aRedisProps = []; // To store property names corresponding to the first-level multi-exec query
        var aRedisSubProps = []; // To store property names corresponding to the second-level multi-exec query
        var hMySqlQueries = {}; // To store what we need to pull remaining data from MySql, if necessary.

        if (hOpts && hOpts.hPropertyOpts && hOpts.sProperty) {
            var oParent = hOpts.oParent;
            var hSettings = hOpts.hSettings;
            var sProperty = hOpts.sProperty;
            hOpts = hOpts.hPropertyOpts;

            switch (sProperty.substring(0,1)) {
                case 'n':
                case 's':
                    oParent[sProperty] = null;
                    break;
                case 'o':
                    var sClass = (hSettings.hExtras[sProperty].sClass) ? hSettings.hExtras[sProperty].sClass : (oParent.get('nObjectClass')) ? App.hClassMap[oParent.get('nObjectClass')] : null;
                    if (sClass)
                        oParent[sProperty] = Base.lookup({sClass:sClass});
                    break;
                case 'c':
                    if (!Collection)
                        Collection  = require('./../../Collection');
                    oParent[sProperty] = new Collection({sClass:hSettings.hExtras[sProperty].sClass});
                    break;
            }

            if (!hSettings.hExtras[sProperty]) {
                App.error('Trying to loadExtra on property that is not configured: '+sProperty+'; Class: '+oParent[sProperty].sClass);
                callback();
            } else {
                var sKey = (oParent.get('nID')) ? oParent.nClass+':'+oParent.get('nID')+':'+sProperty : null;
                aRedisProps.push(sProperty);

                async.series([
                    function(cb) {
                        // Instantiate Redis connection if needed.
                        if (!oRedisClient)
                            App.Redis.acquire(function(err,oClient){
                                oRedisClient = oClient;
                                if (!err) {
                                    oRedisMulti = oRedisClient.multi();
                                    oRedisSubMulti = oRedisClient.multi();
                                }
                                cb(err);
                            });
                        else {
                            oRedisMulti = oRedisClient.multi();
                            oRedisSubMulti = oRedisClient.multi();
                            cb();
                        }
                    }
                    ,function(cb){
                        // Queue up redis calls and mysql queries.
                        switch (sProperty.substring(0,1)) {
                            case 'n':case 's':
                                oRedisMulti.get(sKey);
                                break;
                            case 'o':
                                if (hSettings.hExtras[sProperty].aKey)
                                    oRedisMulti.hgetall(oParent[sProperty].nClass+':'+oParent.get(hSettings.hExtras[sProperty].aKey[0]));
                                else
                                    App.warn('No key defined for '+sProperty);
                                break;
                            case 'c':
                                // Populate the query required to retrieve this collection via MySql, in case we get nothing from redis.
                                hMySqlQueries[sProperty] = hSettings.hExtras[sProperty].fnQuery(oParent,App);

                                oParent[sProperty].nSize = (hOpts) ? hOpts.nSize || 0 : 0;
                                oParent[sProperty].nFirstID = (hOpts) ? hOpts.nFirstID || null : null;
                                oParent[sProperty].bReverse = (hOpts) ? hOpts.bReverse || false : false;

                                // Get all we can get in the first pass:
                                // This gets our nTotal
                                if (hOpts && hOpts.nMin)
                                    oRedisMulti.zcount(sKey,hOpts.nMin,726081834000);
                                else
                                    oRedisMulti.zcard(sKey);

                                // If no paging directives, we can go ahead and get our set.
                                if (!oParent[sProperty].nFirstID) {
                                    oParent[sProperty].nStart = 0;
                                    oParent[sProperty].nEnd = oParent[sProperty].nSize || -1;

                                    // Put another copy of the property in so we don't lose sync.
                                    aRedisProps.push(sProperty);
                                    if (oParent[sProperty].bReverse)
                                        oRedisMulti.zrevrange(sKey,oParent[sProperty].nStart,oParent[sProperty].nEnd);
                                    else
                                        oRedisMulti.zrange(sKey,oParent[sProperty].nStart,oParent[sProperty].nEnd);
                                }

                                break;
                        }
                        cb();
                    }
                    ,function(cb){
                        // Check redis first.
                        if (aRedisProps.length){
                            oRedisMulti.exec(function(err,aResults){
                                if (err || !aResults || !aResults.length)
                                    cb(err);
                                else {
                                    aRedisProps.forEach(function(sProp,n) {
                                        switch (sProp.substring(0,1)) {
                                            case 'n':
                                                oParent[sProp] = oParent.toNumber(aResults[n])
                                                break;
                                            case 'o':
                                                oParent[sProp].hData = aResults[n];
                                                break;
                                            case 's':
                                                oParent[sProp] = aResults[n];
                                                break;
                                            case 'c':
                                                if (aResults[n] instanceof Array && aResults[n].length) {
                                                    // We now have an array of IDs that contains our set. We're going to use later.
                                                    aResults[n].forEach(function(sKey) {
                                                        aRedisSubProps.push(sProp);
                                                        oRedisSubMulti.hgetall(sKey);
                                                    });
                                                } else
                                                    oParent[sProp].nTotal = aResults[n];
                                                break;
                                        }
                                    });
                                    cb();
                                }
                            });
                        } else
                            cb();
                    }
                    ,function(cb) {
                        // For nested redis lookups.
                        if (aRedisSubProps.length) {
                            oRedisSubMulti.exec(function(err,aResults){
                                if (err)
                                    cb(err);
                                else {
                                    aRedisSubProps.forEach(function(hProp,n) {
                                        switch (sProperty.substring(0,1)) {
                                            case 'o':
                                                // If redis is successful, we'll remove the property from
                                                // mysql's hash so it will ignore.
                                                if (aResults[n] && aResults[n].nID) {
                                                    oParent[sProperty].setData(aResults[n]);
                                                    delete hMySqlQueries[sProperty];
                                                }
                                                break;
                                            case 's':
                                                oParent[sProperty] = aResults[n];
                                                break;
                                            case 'c':
                                                oParent[sProperty].add(aResults[n],true);
                                                break;
                                        }
                                    });
                                    cb();
                                }
                            });
                        } else
                            cb();
                    }
                    ,function(cb) {

                        // See what's left for mysql to do.
                        var aStatements = []; var aValues = [];
                        // Keep the properties retrieved in order that we push the statements in.
                        var aProps = []
                        for (sProperty in hMySqlQueries) {
                            aProps.push(sProperty);
                            var hQuery = App.MySql.generateQuery(hMySqlQueries[sProperty],oParent,sProperty);
                            aStatements.push(hQuery.aStatements);
                            aValues.push(hQuery.aValues);
                        }
                        if (aStatements.length) {
                            App.MySql.execute(null,aStatements.join(';'),aValues.join(','),function(err,aResults){
                                aProps.forEach(function(sProperty,n){
                                    if (aResults && aResults[n])
                                        switch (sProperty.substring(0,1)) {
                                            case 'o':
                                                oParent[sProperty].hData = aResults[n];
                                                break;
                                            case 'c':
                                                oParent[sProperty].aObjects = aResults[n];
                                                break;
                                        }
                                });
                                cb();
                            });
                        } else
                            cb();
                    }
                    ,function(cb) {
                        if (hOpts && hOpts.hExtras) {
                            var subQ = async.queue(loadExtra,10);
                            subQ.drain = cb;

                            for (var sSubProperty in hOpts.hExtras) {
                                if (oParent[sProperty] instanceof Collection) {
                                    (function loop(){
                                        if (oParent[sProperty].next()) {
                                            subQ.push({
                                                oParent:oParent[sProperty].getCurrent(),
                                                sProperty:sSubProperty,
                                                hPropertyOpts:hOpts.hExtras[sSubProperty],
                                                hSettings:oParent[sProperty].getCurrent().hSettings()
                                            });
                                            setImmediate(loop);
                                        }
                                    })();
                                } else {
                                    subQ.push({
                                        oParent:oParent[sProperty],
                                        sProperty:sSubProperty,
                                        hPropertyOpts:hOpts.hExtras[sSubProperty],
                                        hSettings:oParent[sProperty].hSettings()
                                    });
                                }
                            }
                        } else
                            cb();
                    }
                ],callback);
            }
        } else {
            callback();
        }
    };

    var q = async.queue(loadExtra,10);
    q.drain = function(err){
        fnCallback(err,oSelf);
    };
    // If we have any extras to load, it will be in the hExtras directive of the passed-in options.
    for (var sProperty in hExtras) {
        q.push({
            oParent:oSelf,
            sProperty:sProperty,
            hPropertyOpts:hExtras[sProperty],
            hSettings:oSelf.hSettings()
        });
    }
    q.push({});
};
/**
 * Used to wholesale load the hData section of the object, either loading from data source or
 * from user input.
 * @param hOpts
 * @param bIgnoreDelta
 */
p.setData = function(hOpts,bIgnoreDelta) {
    var oSelf = this;
    if (hOpts) {
        var hSettings = oSelf.hSettings();
        async.parallel([
            function(callback) {
                if (hOpts instanceof Base) {
                    oSelf.copyData(hOpts);
                    callback();
                } else if (hOpts.hData)
                    callback(null,hOpts.hData);
                else
                    callback(null,hOpts);
            }
        ],function(err,aResults){
            var hData = aResults[0];
            oSelf.bIgnoreDelta = bIgnoreDelta;
            for (var sProp in hData) {
                if (!sProp.match(/^(hDelta|parse|_typeCast)$/) && hData[sProp] != undefined && !hData[sProp].toString().match(/(undefined|\[Function function\])/))
                    oSelf.set(sProp,hData[sProp]);
                else if (sProp.substring(0,1) == 'b' && !hData[sProp]) {
                    oSelf.set(sProp,false);
                }
            }
            delete oSelf.bIgnoreDelta;
        });
    }
};
/**
 * This method is used to copy properties from one object to another, thus de-referencing them.
 * This method is expecting a Base object.
 * @param oBase
 */
p.copyData = function(oBase) {
    var oSelf = this;
    for (var sProp in oBase.hData) {
        oSelf.set(sProp,oBase.get(sProp),true);
    }
};
/**
 * Use this method to set properties. The reasons are:
 *
 * 1. it allows us to segregate all data properties into the 'hData' property on a Base object.
 * This allows us to dump data directly into Redis without any serialization/deserialization in the exchange.
 * 2. It separates data from other properties that we may set along the way. So, we can easily iterate
 * through data properties without crossing into other properties.
 * 3. It allows us to drop the data retrieved from MySql directly into the hData without overwriting
 * any temporary properties we may have set on the object leading up.
 * 4. It allows us to obfuscate the date-related wrangling we have to do with dates coming out from MySql/Redis
 *
 * @param sProperty
 * @param value
 */
p.set = function(sProperty,value,bIgnoreDelta){
    var sFirstLetter = sProperty.substring(0,1);
    var oldVal = this.hData[sProperty];
    switch (sFirstLetter) {
        case 'b':
            this.hData[sProperty] = sanitize(value).toBoolean();
            break;
        case 'n':
            this.hData[sProperty] = this.toNumber(sanitize(value).toInt());
            break;
        case 's':
            this.hData[sProperty] = sanitize(value).xss();
            break;
        case 'h':
            this.hData[sProperty] = value;
            break;
    }
    if (!bIgnoreDelta && !this.bIgnoreDelta && this.get('nID') && oldVal != this.hData[sProperty] && !sProperty.match(/^(nID|nUpdated|nCreated)$/)) {
        if (!this.hDelta) this.hDelta = {};
        this.hDelta[sProperty] = {
            old:oldVal,
            new:this.hData[sProperty]
        };
    }
};
/**
 * Use this method to retrieve data properties from hData.
 *
 * @param sProperty
 * @return {*}
 */
p.get = function(sProperty){
    var oSelf = this;
    if (oSelf.hData && sProperty) {
        switch (sProperty.toString().substring(0,1)) {
            case 'n':
                // But we need to preserve nulls.
                if (isNaN(oSelf.hData[sProperty])===false)
                    return parseFloat(oSelf.hData[sProperty]);
                else
                    return null;
                break;
            case 'b':
                return (oSelf.hData[sProperty] == true || oSelf.hData[sProperty]==1 || (oSelf.hData[sProperty] && oSelf.hData[sProperty].toString()=='true'));
                break;
            default:
                return oSelf.hData[sProperty];
                break;
        }
    } else
        return null;
};
/**
 * This method is the setter for properties that represent Redis sets, keys, or other extra-object data related
 * to this object.
 *
 * @param sProperty - String value for the property name. Expecting prefix 'a' or 'incr'
 * @param Value - The value to add to an array or increment by.
 * @param fnCallback
 */
p.setExtra = function(sProperty,Value,fnCallback) {
    var oSelf = this;
    if (sProperty && Value) {
        async.series([
            function(callback){
                if (!oSelf.get('nID'))
                    oSelf.setID(callback);
                else
                    callback();
            }
            ,function(callback) {
                // Locate the hExtras settings for this class.
                var hSettings = oSelf.hSettings().hExtras[sProperty];
                if (!hSettings)
                    callback('No settings for '+oSelf.sClass+'.'+sProperty);
                else {
                    var sKey = oSelf.nClass + ':' + oSelf.get('nID') + ':' + sProperty;
                    var nTTL = hSettings.nTTL || oSelf.hSettings().nTTL;

                    switch (hSettings.sType) {
                        case 'Collection':
                            // If the collection doesn't yet exist, instantiate it.
                            if (!oSelf[sProperty]) {
                                if (!Collection) Collection = require('./Collection');
                                oSelf[sProperty] = new Collection({sClass:hSettings.sClass});
                            }
                            // Don't save it again if it doesn't need saving.
                            async.waterfall([
                                function(callback) {
                                    if (Value instanceof Base && (!Value.get('nID') || Value.hDelta))
                                        Value.save({nTTL:nTTL}, callback);
                                    else
                                        callback(null,Value);
                                }
                                ,function(oVal,callback) {
                                    oSelf[sProperty].add(oVal);
                                    if (oVal instanceof Base) {
                                        async.parallel([
                                            function(cb){
                                                if (!App.Redis.hSettings.bSkip)
                                                    App.Redis.addToSet({
                                                    sKey:sKey,
                                                    nTTL:nTTL,
                                                    sSortBy:hSettings.sSortBy
                                                }, oVal, cb);
                                                else
                                                    cb();
                                            }
                                            ,function(cb){
                                                if (!App.MySql.hSettings.bSkip)
                                                    App.MySql.addToSet({
                                                        sKey:sKey,
                                                        sSortBy:hSettings.sSortBy
                                                    }, oVal, cb);
                                                else
                                                    cb();
                                            }
                                        ],callback);
                                    } else
                                        callback();
                                }
                            ],callback);
                            break;
                        case 'Increment':
                            App.Redis.increment({sKey:sKey, nTTL:nTTL}, Value, function (err, res) {
                                if (res)
                                    oSelf[sProperty] = res;
                                callback(err,oSelf[sProperty]);
                            });
                            break;
                        case 'String':
                            oSelf[sProperty] = Value;
                            App.Redis.set({sKey:sKey, nTTL:nTTL}, Value, callback);
                            break;
                        case 'Number':
                            oSelf[sProperty] = oSelf.toNumber(Value);
                            App.Redis.set({sKey:sKey, nTTL:nTTL}, Value, callback);
                            break;
                        case 'Object':
                            oSelf[sProperty] = Value;
                            async.series([
                                function(callback) {
                                    if (!Value.get('nID'))
                                        Value.setID(callback);
                                    else
                                        callback();
                                }
                                ,function(callback) {

                                    async.parallel([
                                        function(cb) {
                                            if (hSettings.aKey) {
                                                oSelf[sProperty].set(hSettings.aKey[0],oSelf[sProperty].get(hSettings.aKey[1]));
                                                oSelf[sProperty].save(null,cb);
                                            } else
                                                cb();
                                        }
                                        ,function(cb) {
                                            if (!App.Redis.hSettings.bSkip)
                                                App.Redis.set({sKey:sKey, nTTL:nTTL}, Value, callback);
                                            else
                                                cb();
                                        }
                                        ,function(cb){
                                            if (!App.MySql.hSettings.bSkip)
                                                App.MySql.saveObject(null,oSelf[sProperty],cb);
                                            else
                                                cb();
                                        }
                                    ],function(err){
                                        if (!err && oSelf[sProperty]) oSelf[sProperty].clean();
                                        callback(err);
                                    });
                                }
                            ],callback);

                            break;
                    }
                }
            }
        ],function(err){
            if (oSelf.txid) oSelf.publish({sClass:'Status',sChanged:sProperty, Value:Value});
            if (fnCallback)
                fnCallback(err,oSelf);
        });
    } else if (fnCallback)
        fnCallback(null,oSelf);
};
/**
 * Used to remove an extra from an object. This includes identifying and removing an item
 * from a collection.
 * @param sProperty
 * @param Value
 * @param fnCallback
 */
p.deleteExtra = function(sProperty,Value,fnCallback) {
    var oSelf = this;
    oSelf.sSource = (oSelf.sSource) ? oSelf.sSource : App.sDefaultDb;

    var done = function(err) {
        if (oSelf.txid) oSelf.publish({sClass:'Status',sRemoved:sProperty,Value:Value});
        if (fnCallback) fnCallback(err);
    };
    if (oSelf.get('nID')) {
        var hSettings = oSelf.hSettings().hExtras[sProperty];
        // If the user didn't pass anything in except the property name,
        // we assume he wants to delete the whole extra from Redis.
        var sKey = oSelf.nClass+':'+oSelf.get('nID')+':'+sProperty;
        if (!Value) {
            App[oSelf.sSource].del(sKey,function(err){
                switch (hSettings.sType) {
                    case 'Collection':
                        var Collection = require('./Collection');
                        oSelf[sProperty] = new Collection({sClass:hSettings.sClass});
                        break;
                    case 'String':
                        oSelf[sProperty] = '';
                        break;
                    case 'Integer':
                    case 'Increment':
                        oSelf[sProperty] = 0;
                        break;
                    case 'Object':
                        oSelf[sProperty] = Base.lookup({sClass:hExtras[sProperty].sClass});
                        break;
                }
                done(err);
            });
        } else if (hSettings && hSettings.sType == 'Collection') {
            // Find the item in the collection and remove it.
            if (oSelf[sProperty]) {
                while (oSelf[sProperty].next()) {
                    if (parseInt(oSelf[sProperty].getCurrent().get('nID')) == parseInt(Value.get('nID'))) {
                        oSelf[sProperty].aObjects.splice(oSelf[sProperty]._nIndex,1);
                        oSelf[sProperty].nTotal--;
                        oSelf[sProperty].nCount--;
                        break;
                    }
                }
            }
            // If the user wants to remove an individual item from a collection:
            App[oSelf.sSource].zrem(sKey,[Value.nClass+':'+Value.get('nID')],function(err){
                done(err);
            });
        }
    } else
        done();
};
/**
 * The save method handles a few items: 1) It checks for duplicates on new item creation,
 * 2) It assigns nID on new item creation (if using Redis as primary data store), and 3) does
 * the actual save of the object.
 *
 * @param hOpts
 * @param fnCallback
 */
p.save = function(hOpts,fnCallback) {
    var oSelf = this;
    // Set sID if needed

    if (oSelf.hSettings().nLengthOfsID && !oSelf.get('sID'))
        oSelf.set('sID',String.getSID(oSelf.hSettings().nLengthOfsID));

    oSelf.setID(function() {
        oSelf.sDestination = (hOpts && hOpts.sDestination) ? hOpts.sDestination : (oSelf.sSource) ? oSelf.sSource : App.sDefaultDb;

        if (oSelf.hDelta || oSelf.bNew || (hOpts && hOpts.bForce)) {
            async.parallel([
                function(callback) {
                    if (!App.Redis.bSkip)
                        App.Redis.saveObject(hOpts,oSelf,callback);
                    else
                        callback();
                }
                ,function(callback) {
                    if (!App.MySql.hSettings.bSkip)
                        App.MySql.saveObject(hOpts,oSelf,callback);
                    else
                        callback();
                }
            ],function(err){
                if (err)
                    fnCallback(err);
                else {
                    if (hOpts && hOpts.bForce)
                        oSelf.bForce = hOpts.bForce;
                    if (oSelf.txid) oSelf.publish();
                    if (fnCallback)
                        fnCallback(null,oSelf);
                }
            });

        } else if (fnCallback)
            fnCallback(null,oSelf);
    });
};
/**
 * This method assigns a primary key id to the object using Redis' incrby method.
 * @param fnCallback
 */
p.setID = function(fnCallback) {
    var oSelf = this;
    if (!oSelf.get('nCreated'))
        oSelf.set('nCreated',new Date().getTime());

    if (!oSelf.get('nID')) {
        oSelf.bNew = true;
        if (!oSelf.get('nUpdated'))
            oSelf.set('nUpdated',new Date().getTime());
        App.Redis.getNextID(oSelf,fnCallback);
    } else {
        oSelf.set('nUpdated',new Date().getTime());
        fnCallback(null,oSelf.get('nID'));
    }
};
/**
 * This returns the environment-specific settings for the class. This will use the 'global' environment
 * settings in the .conf file, overridden by what's configured in the class itself, overridden by any
 * environment specific settings if any.
 *
 * @return {*}
 */
p.hSettings = function() {
    if (App.hClasses[this.sClass])
        return App.hClasses[this.sClass];
};
/**
 * This method should only be used by internal code for cleaning up records created for testing purposes.
 * @param fnCallback
 */
p.delete = function(fnCallback) {
    var oSelf = this;
    if (oSelf.get('nID')) {
        async.parallel([
            function(callback) {
                if (App.Redis)
                    App.Redis.deleteObject(oSelf,callback);
                else
                    callback();
            }
            ,function(callback) {
                if (!App.MySql.hSettings.bSkip)
                    App.MySql.deleteObject(oSelf,callback);
                else
                    callback();
            }
        ],function(err){
            oSelf.bRemoved = true;
            if (oSelf.txid) oSelf.publish();
            if (fnCallback)
                fnCallback(err,oSelf);
        });
    } else if (fnCallback) {
        fnCallback();
    }
};
/**
 * This method removes bNew and hDelta properties so no further event saving is triggered when
 * adding to extras on other objects. This is mainly called from the event_q handlers.
 */
p.clean = function(){
    delete this.bNew;
    delete this.hDelta;
};

p.getImageSpecHash = function(oApiConsumer) {
    var oSelf = this;
    var hSpecs = {};
    for (var sType in oSelf.hSettings().hImages) {
        hSpecs[sType] = {
            sUrl:oSelf.getImage('s'+sType),
            sThumb:oSelf.getImage('s'+sType+'20'),
            sDescription:oSelf.hSettings().hImages[sType].sDescription||'',
            sBGColor:(oSelf.hSettings().hImages[sType].sBGColor) ? oApiConsumer.get(oSelf.hSettings().hImages[sType].sBGColor) : '#fff'
        };

        // Get largest set of w/h.
        var nSize = 0;
        for (var i = 0; i < oSelf.hSettings().hImages[sType].aSizes.length; i++) {
            var hSize = oSelf.hSettings().hImages[sType].aSizes[i];
            if (hSize.nSize > nSize) {
                nSize = hSize.nSize;
                hSpecs[sType].nWidth = hSize.nWidth;
                hSpecs[sType].nHeight = hSize.nHeight;
            }
        }
    }
    return hSpecs;
};

p.getImage = function(sType) {
    var oSelf = this;
    var sImage;
    if (sType && oSelf.get(sType))
        sImage = oSelf.get(sType);

    return sImage||'';
};

p.toHash = function(hExtras) {
    var oSelf = this;
    var hResult = {sClass:oSelf.sClass,nClass:oSelf.nClass};
    if (oSelf.get('nID')) {
        for (var sProp in oSelf.hData) {
            switch (sProp) {
                case 'sSecret':case 'sPassword':case '_nIndex':case '_nPosition':
                    //do nothing;
                    break;
                case 'sOwner':
                    hResult[sProp] = oSelf.get('sOwner');
                    break;
                case 'sImage':
                    hResult[sProp] = oSelf.getImage();
                    break;
                case 'nID':
                    if (oSelf.get('n'+oSelf.sClass+'ID'))
                        hResult[sProp] = oSelf.get('n'+oSelf.sClass+'ID');
                    else
                        hResult[sProp] = oSelf.get('nID');

                    hResult['n'+oSelf.sClass+'ID'] = hResult[sProp];
                    break;
                case 'sID':
                    hResult[sProp] = oSelf.hData[sProp];
                    hResult['s'+oSelf.sClass+'ID'] = oSelf.get('sID');
                    break;
                case 'nPlaceID':
                    hResult[sProp] = oSelf.hData[sProp];
                    if (oSelf.hData[sProp] && oSelf.oPlace)
                        hResult.oPlace = oSelf.oPlace.toApiHash();
                    break;
                default:
                    switch (sProp.substring(0,1)) {
                        case 'b':
                            hResult[sProp] = (oSelf.hData[sProp]) ? 1 : 0;
                            break;
                        case 's':
                            hResult[sProp] = oSelf.hData[sProp] || '';
                            break;
                        default:
                            hResult[sProp] = oSelf.hData[sProp];
                            break;
                    }
                    break;
            }
        }
        hResult.hImage = oSelf.getImageHash();

        if (hExtras) {
            for (var sProp in hExtras) {
                if (oSelf[sProp] && oSelf[sProp] instanceof Base)
                    hResult[sProp] = oSelf[sProp].toHash(hExtras[sProp].hExtras);
            }
        }
    }
    return hResult;
};

p.getImageHash = function() {
    var oSelf = this;
    if (oSelf.hSettings() && oSelf.hSettings().aImages) {
        var hResult = {};
        for (var i = 0; i <  oSelf.hSettings().aImages.length; i++) {
            hResult[oSelf.hSettings().aImages[i]] = oSelf.getImage(oSelf.hSettings().aImages[i]);
        }
        return hResult;
    }
};

p.publish = function(hMsg) {
    var oSelf = this;

    // Three cases trigger a publish: 1) object creation, 2) object update with hDelta dictionary, and 3) calls to the setExtra method.
    if (hMsg) {
        if (!hMsg.sChanged || hMsg.Value)
            App.publish(oSelf,hMsg);
    } else if ((oSelf.bNew || oSelf.hDelta || oSelf.bRemoved || oSelf.get('bRemoved') || oSelf.bForce)) {

        var sRootDir = process.env.NORDIS_ENV_ROOT_DIR+'/lib/EventAdapters';
        var Handler = (App.hEventHandlers) ? App.hEventHandlers[oSelf.sClass] : null;
        if (!Handler && fs.existsSync(sRootDir+'/'+oSelf.sClass+'.js')) {
            Handler = require(sRootDir+'/'+oSelf.sClass);
            App.hEventHandlers[oSelf.sClass] = Handler;
        }
        if (Handler)
            Handler.handle(oSelf.bNew,oSelf.hDelta,(oSelf.bRemoved || oSelf.get('bRemoved')),oSelf);
        // Delete bNew, bQueue hDelta because we've logged it and don't want to do it again.
        oSelf.clean();
    }
};

p.toNumber = function(value) {
    try {
        check(value).isInt();
        return sanitize(value).toInt();
    } catch (err) {
        try {
            check(value).isFloat();
            return sanitize(value).toFloat();
        } catch (err2) {
            return null;
        }
    }
};

module.exports = Base;

/**
 * This is a helper method that makes REST calls of the API, parses the responses, and puts
 * the aEvents and aExceptions items into hashes for easy retrieval and checking by unit tests.
 * @param hOpts
 * @param fnCallback
 */
module.exports.callAPI = function(hOpts,fnCallback) {
    async.parallel([
        function(callback) {
            if (process.env.NORDIS_ENV == 'local') {
                REST.request(hOpts,callback);
            } else
                callback();
        },
        function(callback) {
            if (process.env.NORDIS_ENV != 'local')
                REST.secureRequest(hOpts,callback);
            else
                callback();
        }
    ],function(err,aResults){
        var oResult = aResults[0] || aResults[1];
        if (err) {
            App.error(err);
            fnCallback(err);
        } else {
            try {
                var oResponse = JSON.parse(oResult.data);
                // Store exceptions in a hash with the nType (aka error code) as the key.
                if (oResponse.aExceptions) {
                    oResponse.hExceptions = {};
                    for (var n = 0; n < oResponse.aExceptions.length; n++) {
                        oResponse.hExceptions[oResponse.aExceptions[n]['nType']] = oResponse.aExceptions[n];
                    }
                }
                if (fnCallback)
                    fnCallback(null,oResponse);
            } catch (err2) {
                if (err2)
                    App.error(err2);
                if (fnCallback)
                    fnCallback(null,oResult);
            }
        }
    });
};
/**
 * This method will either lookup or return an object of the passed-in sClass (or nClass) type.
 * If the class has a custom path, its module will be properly required.
 * @param hOpts
 * @param fnCallback
 */
module.exports.lookup = function(hOpts,fnCallback) {
    if (hOpts.nClass && !hOpts.sClass)
        hOpts.sClass = App.hClassMap[hOpts.nClass];

    if (!hOpts.sClass || !App.hClasses[hOpts.sClass])
        throw('No sClass or nClass specified! '+JSON.stringify(hOpts));
    else if (App.hClasses[hOpts.sClass].sPath) {
        if (!require.cache[App.sRootClassPath+App.hClasses[hOpts.sClass].sPath])
            App.hClasses[hOpts.sClass].oLoaded = require(App.sRootClassPath+App.hClasses[hOpts.sClass].sPath);

        return new require.cache[App.sRootClassPath+App.hClasses[hOpts.sClass].sPath](hOpts,fnCallback);
    } else
        return new Base(hOpts,fnCallback);
};

module.exports._find = function(hOpts,cColl) {
    if (cColl && cColl.nTotal)
        while (cColl.next()) {
            var bMatch = true;
            var oItem = cColl.getCurrent();
            for (var sKey in hOpts) {
                if (hOpts[sKey] != oItem.get(sKey))
                    bMatch = false;
            }
            if (bMatch)
                return oItem;
        }
};