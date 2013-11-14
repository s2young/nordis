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
                oSelf.sSource = (hOpts.sSource) ? hOpts.sSource : (hOpts && hOpts.sSource=='Redis' && hOpts.sSource!='MySql') ? 'Redis' : ((!hOpts || !hOpts.hQuery.sWhere) && !App.Redis.hSettings.bSkip) ? 'Redis' : 'MySql';
                async.waterfall([
                    function(callback) {
                        if (oSelf.sSource == 'Redis') {
                            App.Redis.loadObject(hOpts,oSelf,callback);
                        } else
                            callback(null,null);
                    }
                    ,function(oObj,callback) {
                        if (oSelf.sSource == 'MySql' || (!oSelf.get('nID') && !App.MySql.hSettings.bSkip)) {
                            App.MySql.loadObject(hOpts,oSelf,callback);
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

    // If this is called recursively, we should already have one or more connections alive.
    var hClients = (hExtras.hClients) ? hExtras.hClients : {};
    delete hExtras.hClients;
    var sSource = hExtras.sSource || oSelf.sSource;
    delete hExtras.sSource;

    // Used to load data into the extra, recursively as instructed in the hExtras directive.
    var loadExtra = function(hOpts,callback){

        if (hOpts && hOpts.hPropertyOpts && hOpts.sProperty && hOpts.sProperty != 'sSource') {
            var oParent = hOpts.oParent;
            var hSettings = hOpts.hSettings;
            var sProperty = hOpts.sProperty;
            if (!hSettings || !hSettings.hExtras || !hSettings.hExtras[sProperty]) {
                callback('Trying to loadExtra on property that is not configured: '+sProperty+' on class: '+oParent.sClass);
            } else {
                var sClass = hSettings.hExtras[sProperty].sClass;
                // Some extras are dynamic in their class, which will be indicated by the presence of a fnGetClass property in conf.js.
                if (!sClass && hSettings.hExtras[sProperty].fnGetClass)
                    sClass = hSettings.hExtras[sProperty].fnGetClass(oParent,App);

                hOpts = hOpts.hPropertyOpts;
                App.info('Load '+sProperty+' ('+sClass+' '+hSettings.hExtras[sProperty].sType+') on '+oParent.sClass+' ('+oParent.get('nID')+')');

                switch (hSettings.hExtras[sProperty].sType) {
                    case 'Increment':
                        oParent[sProperty] = null;
                        break;
                    case 'Object':
                        oParent[sProperty] = Base.lookup({sClass:sClass});
                        break;
                    case 'Collection':
                        if (!Collection)
                            Collection  = require('./Collection');
                        oParent[sProperty] = new Collection({sClass:sClass});
                        break;
                }
                App.debug(oParent[sProperty]);

                var sKey = (oParent.get('nID')) ? oParent.nClass+':'+oParent.get('nID')+':'+sProperty : null;

                // We'll load a redis & mysql client (aka connection), but only when needed and only once.
                var loadClient = function(sSource,callback){
                    if (!hClients[sSource])
                        App[sSource].acquire(function(err,oClient){
                            hClients[sSource] = oClient;
                            callback(err);
                        });
                    else
                        callback();
                };

                async.series([
                    function(cb){
                        // Queue up redis calls and mysql queries.
                        switch (hSettings.hExtras[sProperty].sType) {
                            case 'Increment':
                                loadClient('Redis',function(err){
                                    if (err)
                                        cb(err);
                                    else
                                        hClients.Redis.get(sKey,function(err,res){
                                            oParent[sProperty] = oParent.toNumber(res);
                                            cb(err);
                                        });
                                });
                                break;
                            case 'Object':
                                async.waterfall([
                                    function(cback) {
                                        if (sSource == 'Redis' && hSettings.hExtras[sProperty].aKey && oParent.get(hSettings.hExtras[sProperty].aKey[0]))
                                            loadClient('Redis',function(err){
                                                if (err)
                                                    cback(err);
                                                else
                                                    App.Redis.loadObject({hQuery:{nID:oParent.get(hSettings.hExtras[sProperty].aKey[0])}},oParent[sProperty],cback,hClients.Redis);
                                            });
                                        else
                                            cback(null,null);
                                    }
                                    ,function(res,cback){
                                        if (!res && hSettings.hExtras[sProperty].aKey && oParent.get(hSettings.hExtras[sProperty].aKey[0]))
                                            loadClient('MySql',function(err){
                                                if (err)
                                                    cback(err);
                                                else
                                                    App.MySql.loadObject({hQuery:{nID:oParent.get(hSettings.hExtras[sProperty].aKey[0])}},oParent[sProperty],cback,hClients.MySql);
                                            });
                                        else
                                            cback(null,res);
                                    }
                                    ,function(res,cback) {
                                        if (res && hOpts.hExtras) {
                                            hOpts.hExtras.hClients = hClients;
                                            oParent[sProperty].loadExtras(hOpts.hExtras,cback);
                                        } else
                                            cback();
                                    }
                                ],cb);
                                break;
                            case 'Collection':
                                async.waterfall([
                                    function(callback){
                                        if (sSource == 'MySql')
                                            callback();
                                        else
                                            loadClient('Redis',callback);
                                    }
                                    ,function(callback){
                                        if (sSource == 'MySql')
                                            callback(null,0);
                                        else {
                                            if (hOpts && hOpts.nMin)
                                                hClients.Redis.zcount(sKey,hOpts.nMin,726081834000,callback);
                                            else
                                                hClients.Redis.zcard(sKey,callback);
                                        }
                                    }
                                    ,function(nTotal,callback){
                                        oParent[sProperty].nTotal = nTotal;

                                        if (nTotal) {
                                            oParent[sProperty].sSource = 'Redis';
                                            oParent[sProperty].nSize = (hOpts && hOpts.nSize) ? hOpts.nSize : 0;
                                            oParent[sProperty].nFirstID = (hOpts && hOpts.nFirstID) ? oSelf.toNumber(hOpts.nFirstID) : null;
                                            oParent[sProperty].bReverse = hSettings.hExtras[sProperty].bReverse || false;
                                            delete oParent[sProperty].nNextID;

                                            async.waterfall([
                                                function(cb){
                                                    // First we must determine the range (starting and ending index) to retrieve.
                                                    if (!oParent[sProperty].nFirstID) {
                                                        cb(null,0);
                                                    } else if (oParent[sProperty].bReverse) {
                                                        hClients.Redis.zrevrank(sKey,oParent[sProperty].nClass+':'+oParent[sProperty].nFirstID,cb);
                                                    } else {
                                                        hClients.Redis.zrank(sKey,oParent[sProperty].nClass+':'+oParent[sProperty].nFirstID,cb);
                                                    }
                                                }
                                                ,function(nStart,cb){
                                                    oParent[sProperty].nStart = oSelf.toNumber(nStart);
                                                    oParent[sProperty].nEnd = (oParent[sProperty].nSize) ? (oParent[sProperty].nStart + oParent[sProperty].nSize) : -1;
                                                    delete oParent[sProperty].nFirstID;

                                                    // The sorted set only has pointers, so we must load the individual items in the collection.
                                                    // TODO: This could be done in a multi query. Worth a test.
                                                    var handleResult = function(err,aResult) {
                                                        delete oParent[sProperty].nStart;
                                                        delete oParent[sProperty].nEnd;
                                                        delete oParent[sProperty].bReverse;

                                                        // Every page is a fresh start. We don't append page after page.
                                                        oParent[sProperty].aObjects = [];
                                                        var loadItem = function(sKey,cback){
                                                            hClients.Redis.hgetall(sKey,function(err,res){
                                                                if (err)
                                                                    cback(err);
                                                                else if (hOpts && hOpts.hExtras) {
                                                                    var oObj = oParent[sProperty].add(res,true,true);
                                                                    hOpts.hExtras.hClients = hClients;
                                                                    oObj.loadExtras(hOpts.hExtras,cback);
                                                                } else {
                                                                    oParent[sProperty].add(res,true);
                                                                    cback();
                                                                }
                                                            });
                                                        };

                                                        // If we have a size limit, lop off the last item before processing.
                                                        if (oParent[sProperty].nSize && aResult[oParent[sProperty].nSize]) {
                                                            oParent[sProperty].nNextID = oSelf.toNumber(aResult[oParent[sProperty].nSize].toString().replace(/^[^:]*\:/,''));
                                                            aResult.splice(-1,1);
                                                            oParent[sProperty].nCount = aResult.length;
                                                        } else {
                                                            oParent[sProperty].nCount = aResult.length;
                                                        }
                                                        async.forEachLimit(aResult,100,loadItem,callback);
                                                    };

                                                    if (oParent[sProperty].bReverse)
                                                        hClients.Redis.zrevrange(sKey,oParent[sProperty].nStart,oParent[sProperty].nEnd,handleResult);
                                                    else
                                                        hClients.Redis.zrange(sKey,oParent[sProperty].nStart,oParent[sProperty].nEnd,handleResult);
                                                }
                                            ],callback);

                                        } else {
                                            // Only if Redis has NOTHING do we try mysql on collections.
                                            loadClient('MySql',function(err){
                                                if (err)
                                                    callback(err);
                                                else {
                                                    App.MySql.loadCollection({
                                                        hQuery:hSettings.hExtras[sProperty].fnQuery(oParent,App)
                                                        ,nSize:(hOpts && hOpts.nSize) ? hOpts.nSize : 0
                                                        ,nFirstID:(hOpts && hOpts.nFirstID) ? oSelf.toNumber(hOpts.nFirstID) : null
                                                        ,bReverse:hSettings.hExtras[sProperty].bReverse || false
                                                        ,sOrderBy:hSettings.hExtras[sProperty].sOrderBy
                                                        ,bDebug:true
                                                    },oParent[sProperty],function(err){
                                                        if (err || !oParent[sProperty].nTotal || !hOpts || !hOpts.hExtras)
                                                            callback(err);
                                                        else {
                                                            hOpts.hExtras.hClients = hClients;
                                                            var loadItem = function(oItem,cback){
                                                                oItem.loadExtras(hOpts.hExtras,cback);
                                                            };

                                                            var q = async.queue(loadItem,100);
                                                            q.drain = callback;

                                                            while(oParent[sProperty].next()) {
                                                                q.push(oParent[sProperty].getItem());
                                                            }
                                                        }
                                                    },hClients.MySql);
                                                }
                                            })
                                        }
                                    }
                                ],cb);
                                break;
                        }
                    }
                ],callback);
            }
        } else {
            callback();
        }
    };

    var q = async.queue(loadExtra,1);
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
            this.hData[sProperty] = value;
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
                oSelf.setID(callback);
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
                                                    sOrderBy:hSettings.sOrderBy
                                                }, oVal, cb);
                                                else
                                                    cb();
                                            }
                                            ,function(cb){
                                                if (!App.MySql.hSettings.bSkip)
                                                    App.MySql.addToSet({
                                                        sKey:sKey,
                                                        sOrderBy:hSettings.sOrderBy
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
                            App.Redis.increment({oObj:oSelf,sProperty:sProperty, nTTL:nTTL}, Value, function (err, res) {
                                if (res)
                                    oSelf[sProperty] = res;
                                callback(err,oSelf[sProperty]);
                            });
                            break;
                        case 'Object':
                            oSelf[sProperty] = Value;
                            async.series([
                                function(cb) {
                                    Value.save(null,cb);
                                }
                                ,function(cb) {
                                    if (hSettings.aKey && Value.get(hSettings.aKey[1])) {
                                        oSelf.set(hSettings.aKey[0],Value.get(hSettings.aKey[1]));
                                        oSelf.save(null,cb);
                                    } else
                                        cb();
                                }
                            ],callback);

                            break;
                    }
                }
            }
        ],function(err){
            oSelf.publish({sClass:'Status',sChanged:sProperty, Value:Value});
            if (fnCallback)
                fnCallback(err,oSelf);
        });
    } else if (fnCallback)
        fnCallback(null,oSelf);
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
        if (oSelf.hDelta || oSelf.bNew || (hOpts && hOpts.bForce)) {
            async.parallel([
                function(callback) {
                    if (!App.Redis.hSettings.bSkip)
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
                    oSelf.publish();

                    if (fnCallback) {
                        oSelf.clean();
                        fnCallback(null,oSelf);
                    }
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
                App.Redis.deleteObject(oSelf,callback);
            }
            ,function(callback) {
                App.MySql.deleteObject(oSelf,callback);
            }
        ],function(err){
            oSelf.bRemoved = true;
            oSelf.publish();

            if (fnCallback)
                fnCallback(err,oSelf);
        });
    } else if (fnCallback) {
        fnCallback(null,oSelf);
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
            sUrl:oSelf.get('s'+sType),
            sThumb:oSelf.get('s'+sType+'20'),
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

p.toHash = function(hExtras) {
    var oSelf = this;
    var hResult = {sClass:oSelf.sClass,nClass:oSelf.nClass};
    if (oSelf.get('nID')) {
        for (var sProp in oSelf.hData) {
            switch (sProp) {
                case 'sSecret':case 'sPassword':
                    //do nothing;
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
                default:
                    switch (sProp.substring(0,1)) {
                        case '_':
                            // do nothing, assumed private.
                            break;
                        case 'b':
                            hResult[sProp] = (oSelf.hData[sProp]) ? 1 : 0;
                            break;
                        case 's':
                            hResult[sProp] = oSelf.hData[sProp] || '';
                            break;
                        case 'n':
                            hResult[sProp] = oSelf.toNumber(oSelf.hData[sProp]) || null;
                            break;
                        default:
                            hResult[sProp] = oSelf.hData[sProp];
                            break;
                    }
                    break;
            }
        }
        hResult.hImage = oSelf.getImageHash();
        hResult.hExtras = hExtras;

        if (hExtras) {
            for (var sProp in hExtras) {
                if (oSelf[sProp] && oSelf[sProp] instanceof Base)
                    hResult[sProp] = oSelf[sProp].toHash(hExtras[sProp].hExtras,hExtras[sProp].sPath,hExtras[sProp].nSize);
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
            hResult[oSelf.hSettings().aImages[i]] = oSelf.get(oSelf.hSettings().aImages[i]);
        }
        return hResult;
    }
};

p.publish = function(hMsg) {
    var oSelf = this;

    // Three cases trigger a publish: 1) object creation, 2) object update with hDelta dictionary, and 3) calls to the setExtra method.
    if (hMsg && oSelf.txid) {
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
        var oClass = require(App.sRootClassPath+App.hClasses[hOpts.sClass].sPath);
        return new oClass(hOpts,fnCallback);
    } else
        return new Base(hOpts,fnCallback);
};