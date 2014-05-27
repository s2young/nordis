var validator   = require('validator'),
    AppConfig   = require('./AppConfig'),
    String      = require('./Utils/String'),
    async       = require('async'),
    request     = require('request'),
    promise     = require('promise');

var Collection;
function Base(hOpts,fnCallback){
    var oSelf = this;
    oSelf.hData = {};
    // Set data source for the object.
    if (hOpts) {
        if (hOpts.sClass) {
            oSelf.sClass = hOpts.sClass;
            if (AppConfig.hClasses[oSelf.sClass].nClass) oSelf.nClass = AppConfig.hClasses[oSelf.sClass].nClass;
        } else if (hOpts.nClass) {
            oSelf.nClass = hOpts.nClass;
            oSelf.sClass = AppConfig.hClassMap[oSelf.nClass].sClass;
        }
        if (!oSelf.sClass) {
            delete hOpts.hQuery;
            AppConfig.error('Must supply either nClass or sClass to create an object, and set classes properly in configuration. '+JSON.stringify(hOpts));
        }

        var lookup = function(cb){
            if (!hOpts.sSource)
                hOpts.sSource = (oSelf.getSettings().sDb) ? oSelf.getSettings().sDb : (!AppConfig.Redis.hOpts.bSkip) ? 'Redis' : 'MySql';

            async.waterfall([
                function(callback) {
                    AppConfig.Redis.loadObject(hOpts,oSelf,callback);
                }
                ,function(oObj,callback) {
                    AppConfig.MySql.loadObject(hOpts,oSelf,callback);
                }
                ,function(oObj,callback) {
                    if (hOpts && hOpts.hExtras)
                        oSelf.loadExtras(hOpts.hExtras,callback);
                    else
                        callback(null,oSelf);
                }
            ],cb);
        };

        // The hQuery tells us to try looking up the object. But one can also hard-code the idea of a singleton in config.
        if (hOpts.hQuery) {
            if (fnCallback)
                lookup(fnCallback);
            else
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
var p = Base.prototype;

/**
 * Used for after-initial-object-load lookup of properties on the object.
 * @param hExtras
 * @param fnCallback
 */
p.loadExtras = function(hExtras,fnCallback) {
    var oSelf = this;
    var sSource = hExtras.sSource || oSelf.sSource;
    delete hExtras.sSource;

    // Used to load data into the extra, recursively as instructed in the hExtras directive.
    var loadExtra = function(hOpts,callback){

        if (hOpts && hOpts.hPropertyOpts && hOpts.sProperty && hOpts.sProperty != 'sSource') {
            var oParent = hOpts.oParent;
            var hSettings = hOpts.hSettings;
            var sProperty = hOpts.sProperty;
            if (!hSettings || !hSettings.hExtras || !hSettings.hExtras[sProperty])
                callback('Trying to loadExtra on property that is not configured: '+sProperty+' on class: '+oParent.sClass);
            else {
                var sClass = hSettings.hExtras[sProperty].sClass;

                if (!sClass) {
                    AppConfig.warn('Skipping extra lookup of '+sProperty+' ('+(sClass||'')+' '+hSettings.hExtras[sProperty].sType+') on '+oParent.sClass+' ('+(oParent.getKey())+')');
                    callback();
                } else {
                    hOpts = hOpts.hPropertyOpts;

                    if (hOpts===true) hOpts = {};

                    switch (hSettings.hExtras[sProperty].sType) {
                        case 'Increment':
                            oParent[sProperty] = null;
                            break;
                        case 'Object':
                            oParent[sProperty] = Base.lookup({sClass:sClass});
                            break;
                        case 'Collection':
                            if (!Collection) Collection  = require('./Collection');

                            oParent[sProperty] = new Collection({sClass:sClass});
                            break;
                    }

                    // Queue up redis calls and mysql queries.
                    switch (hSettings.hExtras[sProperty].sType) {
                        case 'Increment':
                            if (oParent.getKey())
                                AppConfig.Redis.get(oParent.getClass()+':'+oParent.getKey()+':'+sProperty,function(err,res){
                                    oParent[sProperty] = oParent.toNumber(res);
                                    callback(err);
                                },hSettings.hExtras[sProperty].sDbAlias||oParent.getSettings().sDbAlias);
                            else
                                callback();
                            break;
                        case 'Object':
                            // Query will be the same for both Redis & MySql, using the numeric key as defined for the class.
                            var hQuery;

                            if (hSettings.hExtras[sProperty].fnQuery)
                                hQuery = hSettings.hExtras[sProperty].fnQuery(oParent,AppConfig,sProperty);
                            else {
                                hQuery = (hSettings.hExtras[sProperty].aKey && oParent.get(hSettings.hExtras[sProperty].aKey[0])) ? {} : null;
                                if (hQuery) hQuery[oParent[sProperty].getSettings().sKeyProperty] = oParent.get(hSettings.hExtras[sProperty].aKey[0]);
                            }

                            async.series([
                                function(cback) {
                                    if (!hQuery && hSettings.hExtras[sProperty].fnQueryOverride) {
                                        hSettings.hExtras[sProperty].fnQueryOverride(oParent[sProperty],oParent,function(err,oObj){
                                            if (!err)
                                                oParent[sProperty] = oObj;
                                            cback(err);
                                        });
                                    } else
                                        cback();
                                }
                                // Try Redis (or config for sample objects).
                                ,function(cback) {
                                    // If the hData is provided in the config (such as we do with stats), just load it.
                                    if (hQuery && !oParent[sProperty].getKey())
                                        AppConfig.Redis.loadObject({hQuery:hQuery,sSource:sSource},oParent[sProperty],cback);
                                    else
                                        cback();
                                }
                                // Then try MySql if not found already.
                                ,function(cback){
                                    if (hQuery && !oParent[sProperty].getKey())
                                        AppConfig.MySql.loadObject({hQuery:hQuery},oParent[sProperty],cback);
                                    else
                                        cback();
                                }
                                // Then load any extras.
                                ,function(cback) {
                                    if (oParent[sProperty].getKey() && hOpts.hExtras)
                                        oParent[sProperty].loadExtras(hOpts.hExtras,cback);
                                    else
                                        cback();
                                }
                            ],callback);

                            break;
                        case 'Collection':

                            var nSize = (hOpts.hExtras && hOpts.hExtras.nSize) ? oSelf.toNumber(hOpts.hExtras.nSize) : (hOpts.nSize) ? oSelf.toNumber(hOpts.nSize) : 0;
                            var nFirstID = (hOpts.hExtras && hOpts.hExtras.nFirstID) ? oSelf.toNumber(hOpts.hExtras.nFirstID) : (hOpts.nFirstID) ? oSelf.toNumber(hOpts.nFirstID) : null;
                            var sFirstID = (hOpts.hExtras && hOpts.hExtras.sFirstID) ? hOpts.hExtras.sFirstID : (hOpts.sFirstID) ? hOpts.sFirstID : null;
                            var nMax = (hOpts.hExtras && hOpts.hExtras.nMax) ? oSelf.toNumber(hOpts.hExtras.nMax) : (hOpts.nMax) ? oSelf.toNumber(hOpts.nMax) : null;
                            var nMin = (hOpts.hExtras && hOpts.hExtras.nMin) ? oSelf.toNumber(hOpts.hExtras.nMin) : (hOpts.nMin) ? oSelf.toNumber(hOpts.nMin) : null;
                            var bReverse = (hOpts.hExtras && hOpts.hExtras.bReverse) ? hOpts.hExtras.bReverse : (hOpts.bReverse) ? hOpts.bReverse : (hSettings.hExtras[sProperty].bReverse) ? hSettings.hExtras[sProperty].bReverse : false;
                            var sOrderBy = (hOpts.hExtras && hOpts.hExtras.sOrderBy) ? hOpts.hExtras.sOrderBy : (hOpts.sOrderBy) ? hOpts.sOrderBy : (hSettings.hExtras[sProperty].sOrderBy) ? hSettings.hExtras[sProperty].sOrderBy : '';

                            async.series([
                                function(cback) {
                                    if (oParent.getKey()) {
                                        AppConfig.Redis.loadCollection({
                                            sKey:oParent.getClass()+':'+oParent.getKey()+':'+sProperty
                                            ,sSource:hSettings.sSource||sSource
                                            ,bReverse:bReverse
                                            ,sOrderBy:sOrderBy
                                            ,nSize:nSize
                                            ,sFirstID:sFirstID||nFirstID
                                            ,nMax:nMax
                                            ,nMin:nMin
                                        },oParent[sProperty],cback);
                                    } else
                                        cback(null,null);
                                }
                                ,function(cback){
                                    if (oParent.getKey() && (!oParent[sProperty] || !oParent[sProperty].nTotal)) {
                                        var hQuery = (hSettings.hExtras[sProperty].fnQuery) ?  hSettings.hExtras[sProperty].fnQuery(oParent,AppConfig,sProperty) : null;
                                        if (hQuery)
                                            AppConfig.MySql.loadCollection({
                                                hQuery:hQuery
                                                ,bReverse:bReverse
                                                ,sOrderBy:sOrderBy
                                                ,nSize:nSize
                                                ,sFirstID:sFirstID||nFirstID
                                                ,nMax:nMax
                                                ,nMin:nMin
                                            },oParent[sProperty],cback);
                                        else
                                            cback();
                                    } else
                                        cback();
                                }
                                ,function(cback){
                                    if (!oParent[sProperty].nTotal || !hOpts || !hOpts.hExtras)
                                        cback();
                                    else {
                                        var loadItem = function(oItem,cback){
                                            if (oItem instanceof Base)
                                                oItem.loadExtras(hOpts.hExtras,cback);
                                            else
                                                cback();
                                        };

                                        var q = async.queue(loadItem,100);
                                        q.drain = cback;

                                        while(oParent[sProperty].next()) {
                                            q.push(oParent[sProperty].getItem());
                                        }
                                        q.push({});
                                    }
                                }
                                ,function(cback) {
                                    if (hOpts && hOpts.hExtras && hOpts.hExtras.nSize)
                                        oParent[sProperty].nSize = hOpts.hExtras.nSize;
                                    else if (hOpts && hOpts.nSize)
                                        oParent[sProperty].nSize = hOpts.nSize;

                                    cback();
                                }
                            ],callback);

                            break;
                    }
                }
            }
        } else
            callback();
    };

    var aProps = [];
    // If we have any extras to load, it will be in the hExtras directive of the passed-in options.
    for (var sProperty in hExtras) {
        if (!sProperty.match(/(nFirstID|sFirstID|nMax|nMin|nSize)/))
            aProps.push({
                oParent:oSelf,
                sProperty:sProperty,
                hPropertyOpts:hExtras[sProperty],
                hSettings:oSelf.getSettings()
            });
    }

    if (aProps.length)
        async.forEach(aProps,loadExtra,function(err){
            fnCallback(err,oSelf);
        });
    else
        fnCallback(null,oSelf);
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
            for (var sProp in hData) {
                if (oSelf.getSettings().hProperties[sProp])
                    oSelf.set(sProp,hData[sProp],bIgnoreDelta);
            }
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
 * @param bIgnoreDelta - boolean indicating whether to ignore the change made (i.e. don't touch the hDelta) to the object.
 */
p.set = function(sProperty,value,bIgnoreDelta){
    if (sProperty && this.hData && this.getSettings().hProperties[sProperty]) {
        var oldVal = this.hData[sProperty];
        switch (this.getSettings().hProperties[sProperty].sType) {
            case 'Boolean':
                this.hData[sProperty] = validator.toBoolean(value);
                break;
            case 'Number':case 'Timestamp':
                this.hData[sProperty] = this.toNumber(value);
                break;
            case 'Float':
                this.hData[sProperty] = parseFloat(value);
                break;
            case 'Decimal':
                this.hData[sProperty] = parseFloat(Math.round(value * 100) / 100).toFixed(this.getSettings().hProperties[sProperty].nScale);
                break;
            default:
                this.hData[sProperty] = value||'';
                break;
        }


        if (!bIgnoreDelta && this.getKey() && oldVal != this.hData[sProperty] && !this.getSettings().hProperties[sProperty].bPrimary ) {
            if (!this.hDelta) this.hDelta = {};
            this.hDelta[sProperty] = {
                old:oldVal,
                new:this.hData[sProperty]
            };
        }
    }
};

p.setHashKey = function(sProperty,sKey,Value) {
    this.getHash(sProperty)[sKey] = Value;
    this.set(sProperty,JSON.stringify(this.getHash(sProperty)));
};
/**
 * Use this method to retrieve data properties from hData.
 *
 * @param sProperty
 * @return {*}
 */
p.get = function(sProperty){
    var oSelf = this;
    if (sProperty && oSelf.hData && oSelf.getSettings().hProperties[sProperty]) {
        switch (oSelf.getSettings().hProperties[sProperty].sType) {
            case 'Boolean':
                return (oSelf.hData[sProperty]) ? true : false;
                break;
            case 'String':
                return oSelf.hData[sProperty] || '';
                break;
            case 'Number':case 'Timestamp':
                if (oSelf.toNumber(oSelf.hData[sProperty]) != undefined)
                    return oSelf.toNumber(oSelf.hData[sProperty]);
                else
                    return null;
                break;
            case 'Float':
                return oSelf.toFloat(oSelf.hData[sProperty]);
                break;
            case 'Decimal':
                return oSelf.toFloat(oSelf.hData[sProperty]).toFixed(oSelf.getSettings().hProperties[sProperty].nScale);
                break;
            default:
                return oSelf.hData[sProperty];
                break;
        }
    } else {
        return null;
    }
};

p.getHashKey = function(sProperty,sKey) {
    return this.getHash(sProperty)[sKey];
};

p.getHash = function(sProperty) {
    if (!this[sProperty]) {
        try {
            this[sProperty] = JSON.parse(this.hData[sProperty]);
        } catch (er) {
            this[sProperty] = {};
        }
    }
    return this[sProperty];
};
/**
 * Shortcut mechanism for pulling the object's primary key value using
 * the sKeyProperty property name as defined in config.
 */
p.getKey = function(){
    if (this.getSettings().sKeyProperty)
        return this.get(this.getSettings().sKeyProperty);
    else
        return null;
};
/**
 * Provides UTC timestamp of the datetime the object was initially saved to the db.
 * @returns {*}
 */
p.getCreateTime = function() {
    return this.get(this.getSettings().sCreateTimeProperty);
};
/**
 * Sets the UTC timestamp marking when the object was initially saved to the db.
 */
p.setCreateTime = function(){
    if (this.getSettings().sCreateTimeProperty && !this.getCreateTime())
        this.set(this.getSettings().sCreateTimeProperty,new Date().getTime());
};
/**
 * Provides UTC timestamp of the last time the object was saved to the db.
 * @returns {*}
 */
p.getUpdateTime = function() {
    return this.get(this.getSettings().sUpdateTimeProperty);
};
/**
 * Updates the UTC timestamp marking the last time the object was saved to the db.
 */
p.setUpdateTime = function(){
    if (this.getSettings().sUpdateTimeProperty)
        this.set(this.getSettings().sUpdateTimeProperty,new Date().getTime(),true);
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
        // Locate the hExtras settings for this class.
        var hSettings = oSelf.getSettings().hExtras[sProperty];
        if (!hSettings)
            fnCallback('No settings for '+oSelf.sClass+'.'+sProperty);
        else {
            var nTTL = hSettings.nTTL || oSelf.getSettings().nTTL;
            async.series([
                function(callback){
                    if (Value instanceof Base && (!Value.getKey() || Value.hDelta)) {
                        AppConfig.debug('Calling save on '+Value.sClass+' ('+oSelf.sClass+'.'+sProperty+')');
                        Value.save({nTTL:nTTL}, callback);
                    } else
                        callback(null,Value);
                }
                ,function(callback) {
                    var sKey = oSelf.getClass() + ':' + oSelf.getKey() + ':' + sProperty;
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
                                    oSelf[sProperty].add(Value);

                                    if ((Value instanceof Base)===false)
                                        Value = Base.lookup({sClass:hSettings.sClass,hData:Value.hData||Value});

                                    if (Value instanceof Base) {
                                        async.parallel([
                                            function(cb){
                                                if (!AppConfig.Redis.hOpts.bSkip)
                                                    AppConfig.Redis.addToSet({
                                                    sKey:sKey,
                                                    nTTL:nTTL,
                                                    sOrderBy:hSettings.sOrderBy
                                                }, Value, cb);
                                                else
                                                    cb();
                                            }
                                            ,function(cb){
                                                if (!AppConfig.MySql.hOpts.bSkip)
                                                    AppConfig.MySql.addToSet({
                                                        sKey:sKey,
                                                        sOrderBy:hSettings.sOrderBy
                                                    }, Value, cb);
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
                            AppConfig.Redis.increment({oObj:oSelf,sProperty:sProperty, nTTL:nTTL}, Value, function (err, res) {
                                if (res)
                                    oSelf[sProperty] = res;
                                callback(err,oSelf[sProperty]);
                            });
                            break;
                        case 'Object':
                            oSelf[sProperty] = Value;
                            async.series([
                                function(cb) {
                                    if (hSettings.aKey && Value.get(hSettings.aKey[1])) {
                                        oSelf.set(hSettings.aKey[0],Value.get(hSettings.aKey[1]));
                                        oSelf.save(cb);
                                    } else
                                        cb();
                                }
                            ],callback);

                            break;
                    }
                }
            ],function(err){
                if (fnCallback)
                    fnCallback(err,oSelf);
            });
        }
    } else if (fnCallback)
        fnCallback(null,oSelf);
};
/**
 * Removes extra from the object or collection.
 * @param sProperty
 * @param Value
 * @param fnCallback
 */
p.deleteExtra = function(sProperty,Value,fnCallback) {
    var oSelf = this;
    if (sProperty && Value && Value instanceof Base) {
        async.series([
            function(callback){
                AppConfig.debug('deleteExtra: DELETE '+Value.sClass+' ('+Value.getKey()+')');
                Value.delete(callback);
            }
            ,function(callback) {
                if (oSelf[sProperty]) {
                    // Locate the hExtras settings for this class.
                    var hSettings = oSelf.getSettings().hExtras[sProperty];
                    var sKey = oSelf.getClass() + ':' + oSelf.getKey() + ':' + sProperty;
                    switch (hSettings.sType) {
                        case 'Collection':
                            // Don't save it again if it doesn't need saving.
                            async.parallel([
                                function(cb) {
                                    // Iterate through the collection and remove the item.
                                    if (oSelf[sProperty].nTotal) {
                                        var n = 0;
                                        while (oSelf[sProperty].next()) {
                                            if (oSelf[sProperty].getItem().getKey() == Value.getKey()) {
                                                AppConfig.debug('deleteExtra: SPLICE ITEM '+n);
                                                oSelf[sProperty].aObjects.splice(n,1);
                                                oSelf[sProperty].nTotal--;
                                                oSelf[sProperty].nCount--;
                                                oSelf[sProperty].reset();
                                                break;
                                            }
                                            n++;
                                        }
                                        cb();
                                    } else
                                        cb();
                                }
                                ,function(cb){
                                    AppConfig.Redis.removeFromSet({
                                        sKey:sKey,
                                        sOrderBy:hSettings.sOrderBy
                                    }, Value, cb);
                                }
                                ,function(cb){
                                    AppConfig.MySql.addToSet({
                                        sKey:sKey,
                                        sOrderBy:hSettings.sOrderBy
                                    }, Value, cb);
                                }
                            ],callback);
                            break;
                        case 'Increment':
                            AppConfig.Redis.del(oSelf.getClass()+':'+oSelf.getKey()+':'+sProperty, function (err) {
                                callback(err,oSelf[sProperty]);
                            });
                            delete oSelf[sProperty];
                            break;
                        default:
                            delete oSelf[sProperty];
                            callback();
                            break;
                    }
                } else
                    callback();
            }
        ],function(err){
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

    if (hOpts instanceof Function) {
        fnCallback = hOpts;
        hOpts = undefined;
    }

    if (!oSelf.getKey()) oSelf.bNew = true;
    // Set string id if required by config.
    if (oSelf.getSettings().sStrKeyProperty && !oSelf.get(oSelf.getSettings().sStrKeyProperty) && oSelf.getSettings().hProperties[oSelf.getSettings().sStrKeyProperty].nLength) {
        oSelf.set(oSelf.getSettings().sStrKeyProperty,String.getSID(oSelf.getSettings().hProperties[oSelf.getSettings().sStrKeyProperty].nLength));
        if (oSelf.getSettings().hProperties[oSelf.getSettings().sStrKeyProperty].bPrimary)
            oSelf.bNew = true;
    }

    async.series([
        function(callback) {
            if (oSelf.getSettings().aRequiredProperties.length) {
                var bFailed;
                for (var i = 0; i < oSelf.getSettings().aRequiredProperties.length; i++) {
                    var sProp = oSelf.getSettings().aRequiredProperties[i];
                    switch (oSelf.getSettings().hProperties[sProp].sType) {
                        case 'String':case 'Timestamp':
                            bFailed = (!oSelf.get(sProp));
                            break;
                        case 'Number':case 'Decimal':case 'Float':
                            bFailed = (oSelf.get(sProp) == undefined || oSelf.get(sProp) == null);
                            break;
                    }
                    if (bFailed) break;
                }
                if (bFailed)
                    callback('Must set required properties: '+oSelf.getSettings().aRequiredProperties.join(','));
                else
                    callback();
            } else
                callback();
        }
        ,function(callback) {
            oSelf.setID(callback);
        }
        ,function(callback) {
            if (oSelf.hDelta || oSelf.bNew || (hOpts && hOpts.bForce)) {
                async.parallel([
                    function(cb) {
                        if (!AppConfig.Redis.hOpts.bSkip && oSelf.getSettings().sDb != 'MySql')
                            AppConfig.Redis.saveObject(hOpts,oSelf,cb);
                        else
                            cb();
                    }
                    ,function(cb) {
                        if (!AppConfig.MySql.hOpts.bSkip && oSelf.getSettings().sDb != 'Redis') {
                            AppConfig.MySql.saveObject(hOpts,oSelf,cb);
                        } else
                            cb();
                    }
                ],callback);
            } else
                callback();
        }
    ],function(err){
        if (hOpts && hOpts.bForce)
            oSelf.bForce = hOpts.bForce;

        oSelf.publish();

        if (fnCallback)
            fnCallback(err,oSelf);
    });
};
/**
 * This method assigns a primary key id to the object using Redis' incrby method.
 * @param fnCallback
 */
p.setID = function(fnCallback) {
    var oSelf = this;
    // We always track when the item was created and last updated.
    oSelf.setCreateTime();
    oSelf.setUpdateTime();

    if (!oSelf.getKey()) {
        oSelf.bNew = true;
        if (!oSelf.getSettings().bAutoIncrementKey)
            AppConfig.Redis.getNextID(oSelf,fnCallback);
        else
            fnCallback(null,oSelf.getKey());
    } else
        fnCallback(null,oSelf.getKey());
};
/**
 * This returns the environment-specific settings for the class. This will use the 'global' environment
 * settings in the .conf file, overridden by what's configured in the class itself, overridden by any
 * environment specific settings if any.
 *
 * @return {*}
 */
p.getSettings = function() {
    return AppConfig.hClasses[this.sClass] || {};
};
/**
 * This method is used for namespacing classes. If the class is configured with an nClass prorperty we use it.
 * Using an nClass allows easy renaming of classes and smaller key-space use in redis.
 */
p.getClass = function(){
    return this.getSettings().nClass || this.sClass;
};
/**
 * This method should only be used by internal code for cleaning up records created for testing purposes.
 * @param fnCallback
 */
p.delete = function(fnCallback) {
    var oSelf = this;
    if (oSelf.getKey()) {
        async.parallel([
            function(callback) {
                AppConfig.Redis.deleteObject(oSelf,callback);
            }
            ,function(callback) {
                AppConfig.MySql.deleteObject(oSelf,callback);
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
/**
 * Hashification method for the object. It takes the hData contents and the aProperties setting as defined for the
 * class in the config file to build a hash that can be serialized using JSON.stringify().
 *
 * It leaves out any extras on the object, unless those are specifically requested in the hExtras parameter, and then
 * only if the extra is already loaded. In otherwords, you should already have called loadExtras if you want to output
 * it here. This is a synchronous method.
 *
 * @param hExtras
 * @returns {}
 */
p.toHash = function(hExtras) {
    var oSelf = this;
    var hResult = {sClass:oSelf.sClass,nClass:oSelf.nClass};
    if (oSelf.getKey()) {
        oSelf.getSettings().aProperties.forEach(function(sProp){
            if (!oSelf.getSettings().hProperties[sProp].bPrivate)
                hResult[sProp] = oSelf.get(sProp);
        });
        hResult.hExtras = hExtras;

        if (hExtras) {
            for (var sProp in hExtras) {
                if (oSelf[sProp] && oSelf[sProp] instanceof Base)
                    hResult[sProp] = oSelf[sProp].toHash(hExtras[sProp].hExtras,hExtras[sProp].sPath,hExtras[sProp].nSize);
            }
        }
        if (oSelf.bRemoved)
            hResult.bRemoved = true;
    }
    return hResult;
};

p.toSampleHash = function() {
    var oSelf = this;
    for (var sProp in AppConfig.hClasses[oSelf.sClass].hProperties) {
        if (AppConfig.hClasses[oSelf.sClass].hProperties[sProp].sSample != undefined)
            oSelf.set(sProp,AppConfig.hClasses[oSelf.sClass].hProperties[sProp].sSample,true);
    }
    return oSelf.toHash();
};

p.publish = function() {
    var oSelf = this;

    // If the class has an adapter configured, then we'll call its handle method.
    if (AppConfig.hClasses[oSelf.sClass].sAdapterPath && (oSelf.bNew || oSelf.hDelta || oSelf.bRemoved)) {
        // Once the handler is loaded, we don't need to do it again. So see if it is loaded in the cache.
        var sAdapterPath = (AppConfig.NORDIS_ENV_ROOT_DIR) ? AppConfig.NORDIS_ENV_ROOT_DIR+AppConfig.hClasses[oSelf.sClass].sAdapterPath   : AppConfig.hClasses[oSelf.sClass].sAdapterPath;
        var Handler = require.cache[sAdapterPath];
        if (!Handler) {
            // Check for overrides and adapters.
            try {
                var Handler = require(sAdapterPath);
            } catch (err) {
                throw new Error('Error when attempting to require adapter for class '+oSelf.sClass+' at path '+sAdapterPath);
            } finally {
                if (Handler && !Handler.handle)
                    throw new Error('Adapter for '+oSelf.sClass+' does not have a handle method: module.exports.handle = function(bNew,hDelta,bRemoved,oObj){}; ');
            }
        }

        if (Handler) {
            if (Handler.handle)
                Handler.handle(oSelf.bNew,oSelf.hDelta,oSelf.bRemoved,oSelf);
            else if (Handler.exports.handle)
                Handler.exports.handle(oSelf.bNew,oSelf.hDelta,oSelf.bRemoved,oSelf);
        }

        // Delete bNew, bQueue hDelta because we've logged it and don't want to do it again.
        oSelf.clean();
    }
};

p.toNumber = function(value) {
    if (validator.isInt(value))
        return validator.toInt(value);
    else if (validator.isFloat(value))
        return validator.toFloat(value);
    else
        return null;
};

p.toFloat = function(value) {
    return validator.toFloat(value);
};

p.toTimestamp = function(value) {
    if (validator.isInt(value))
        return value;
    else {
        var moment = require('moment');
        // Attempt a parse via momentjs.
        var date = moment(value);
        if (date)
            return date.get('millisecond');
        else
            AppConfig.warn('Cannot do anything with '+value+'. Tried converting to timestamp.');
    }
};

/**
 * This method tries to return the best avatar for the current object, using appropriate defaulting/cascading logic
 * to arrive at the proper default avatar if one isn't specified for the object.
 *
 * For example, a Twitter feed group's
 * @param sType
 * @param nSize
 * @return {String}
 */
p.getImage = function(sType,bSecure) {
    var oSelf = this;
    var sImage;
    if (sType && oSelf.getHashKey('sImage',sType))
        sImage = oSelf.getHashKey('sImage',sType);
    else if (oSelf.get('nApiConsumerID') || (oSelf.nClass==AppConfig.nClass_Consumer && oSelf.get('nParentID'))) {
        var nSize = (sType && sType.match(/\d{1,4}$/)) ? sType.match(/\d{1,4}$/)[0] : 20;
        switch (Number(oSelf.nClass)) {
            case AppConfig.nClass_Consumer:
                if (oSelf.get('nParentID') && AppConfig.getConsumer(oSelf.get('nParentID')))
                    sImage = AppConfig.getConsumer(oSelf.get('nParentID')).getImage(sType);
                break;
            case AppConfig.nClass_Comment:
                if (oSelf.oUser) {
                    oSelf.oUser.set('nApiConsumerID',oSelf.get('nApiConsumerID'));
                    sImage = oSelf.oUser.getImage();
                } else
                    sImage = AppConfig.getConsumer(oSelf.get('nApiConsumerID')).getImage('sUserAvatar'+nSize);
                break;
            case AppConfig.nClass_Event:
                if (oSelf.oGroup && oSelf.oGroup.get('nID')) {
                    sImage = oSelf.oGroup.getImage(sType);
                } else {
                    if (!sType)
                        sType = 'sAvatar'+nSize;
                    sImage = AppConfig.getConsumer(oSelf.get('nApiConsumerID')).getImage(sType);
                }
                break;
            case AppConfig.nClass_News:case AppConfig.nClass_Group:
            if (!sType)
                sType = 'sAvatar'+nSize;

            sImage = AppConfig.getConsumer(oSelf.get('nApiConsumerID')).getImage(sType);
            break;
            case AppConfig.nClass_RSVP:case AppConfig.nClass_Role:case AppConfig.nClass_Permit:case AppConfig.nClass_Platform:
            sImage = AppConfig.getConsumer(oSelf.get('nApiConsumerID')).getImage('sUserAvatar'+nSize);
            break;
            case AppConfig.nClass_User:
            case AppConfig.nClass_Directory:
            case AppConfig.nClass_ChildDirectory:
                if (oSelf.nClass == AppConfig.nClass_User && oSelf.get('sImage') && oSelf.get('sImage').match(/^http/))
                    sImage = oSelf.get('sImage');
                else
                    sImage = AppConfig.getConsumer(oSelf.get('nApiConsumerID')).getImage('sUserAvatar'+nSize);
                break;
        }
    }

    if (!sImage) {
        var sWebDomain =  (oSelf.nClass == AppConfig.nClass_Consumer) ? oSelf.get('sWebDomain') : AppConfig.getConsumer(oSelf.get('nApiConsumerID')).get('sWebDomain');
        if (!sType || sType == 'undefined') {
            switch (oSelf.nClass) {
                case AppConfig.nClass_User:
                case AppConfig.nClass_Directory:
                case AppConfig.nClass_ChildDirectory:
                    sType = 'UserAvatar';
                    break;
                default:
                    sType = 'Avatar';
                    break;
            }
        } else if (sType.substring(0,1) == 's') {
            sType = sType.substring(1).replace(/\d{1,4}$/,'');
        }
        sImage = 'http://'+sWebDomain+'/img/'+oSelf.sClass.toLowerCase()+'/'+(oSelf.get('sID')||'new')+'/'+sType+'/'+nSize;
    }

    if (sImage && bSecure)
        sImage = sImage.replace('http:','https:');

    return sImage||'';
};

p.getEscaped = function(sProperty){
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
                return (oSelf.hData[sProperty] === true || oSelf.hData[sProperty]===1 || (oSelf.hData[sProperty] && oSelf.hData[sProperty].toString()=='true'));
                break;
            default:
                return oSelf.hData[sProperty].replace(/\'/g,'\\\'');
                break;
        }
    } else
        return null;
};

module.exports = Base;

/**
 * This method will either lookup or return an object of the passed-in sClass (or nClass) type.
 * If the class has a custom path, its module will be properly required.
 * @param hOpts
 * @param fnCallback
 */
module.exports.lookup = function(hOpts,fnCallback) {
    if (!hOpts.sClass && hOpts.nClass)
        hOpts.sClass = AppConfig.hClassMap[hOpts.nClass];

    if (AppConfig.hClasses[hOpts.sClass] && AppConfig.hClasses[hOpts.sClass].sClassPath) {
        var sClassPath = (AppConfig.NORDIS_ENV_ROOT_DIR) ? AppConfig.NORDIS_ENV_ROOT_DIR+AppConfig.hClasses[hOpts.sClass].sClassPath  : AppConfig.hClasses[hOpts.sClass].sClassPath;
        var oClass = require(sClassPath);
        return new oClass(hOpts,fnCallback);
    } else {
        return new Base(hOpts,fnCallback);
    }
};
/**
 * Promise-based version of lookup
 */
module.exports.lookupP = function(hOpts) {
    return new promise(function (resolve, reject) {
        Base.lookup(hOpts,function(err,oObj){
            if (err)
                reject(err);
            else
                resolve(oObj);
        })
    });
};
/**
 * This method ensures that the passed-in object is a proper Base object. This is used by collections
 * whose data as retrieved from the db is just a hash.
 * @param hObj
 * @param sClass
 */
module.exports.cast = function(hObj,sClass) {
    if ((hObj instanceof Base)===false)
        return Base.lookup({sClass:sClass,hData:hObj});
    else
        return hObj;
};
/**
 * This method is used to load the App singleton, to which Stats are attached as extras. To support
 * multi-tenancy, one can pass in an app id
 * @param sClass
 */
module.exports.loadAppSingleton = function(id,callback) {
    new Base({sClass:'App',hQuery:{id:id}},function(err,oApp){
        if (err)
            callback(err);
        else {
            oApp.set('id',id);
            oApp.set('root',true);
            oApp.bNew = true;
            oApp.save(callback);
        }
    });
};
/**
 * Promise-based REST request method. This method assumes a JSON-formatted response on success.
 */
module.exports.requestP = function(method,url,data) {
    AppConfig.debug(method+' - '+url);

    return new promise(function (resolve, reject) {
        var options = {form:data};
        if (method.toLowerCase()=='get')
            options = {qs:data};
        request[method.toLowerCase()](url,options, function (err, res, body) {
            if (err) {
                return reject(err);
            } else if (res.statusCode !== 200) {
                if (body && body.match(/\{/))
                    return reject(JSON.parse(body)); // Handles passing json response in exceptions.
                else if (body)
                    return reject(body);
                else
                    return reject(res);
            } else
                resolve(JSON.parse(body));
        });
    });
}