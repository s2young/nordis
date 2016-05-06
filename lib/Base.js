var validator   = require('validator'),
    Str      = require('./Utils/String'),
    async       = require('async'),
    request     = require('request'),
    moment      = require('moment-timezone'),
    Config      = require('./AppConfig');
    promise     = require('promise');

var Collection;
function Base(hOpts,fnCallback){
    var oSelf = this;
    oSelf.hData = {};
    // Set data source for the object.
    if (hOpts) {
        
        if (hOpts.sClass && Config.getClasses(hOpts.sClass) && Config.getClasses(hOpts.sClass).nClass) {
            oSelf.sClass = hOpts.sClass;
            oSelf.nClass = Config.getClasses(hOpts.sClass).nClass;
        } else if (hOpts.nClass && Config.getClassMap(hOpts.nClass)) {
            oSelf.nClass = hOpts.nClass;
            oSelf.sClass = Config.getClassMap(hOpts.nClass);
        }

        if (!oSelf.sClass && !oSelf.nClass) {
            if (hOpts.sClass=='Metric')
                oSelf.sClass = hOpts.sClass;
            else {
                delete hOpts.hQuery;
                var sErr = 'The sClass option must be provided to create a Base object!'
                sErr += (hOpts.sClass)?' Maybe invalid class: '+hOpts.sClass : '';
                if (fnCallback)
                    fnCallback(sErr);
                else
                    throw new Error(sErr);
            }
        }

        // Sometimes the API middleware gives us tenant context.
        if (hOpts._Tenant) oSelf._Tenant = hOpts._Tenant;

        // The hQuery tells us to try looking up the object. But one can also hard-code the idea of a singleton in config.
        if (hOpts.hQuery) {
            if (fnCallback) {
                hOpts.sSource = (hOpts.sSource) ? hOpts.sSource : (oSelf.getSettings().sSource) ? oSelf.getSettings().sSource : 'Redis';
                if (oSelf.getSettings().sTenantProperty && hOpts.hQuery[oSelf.getSettings().sTenantProperty])
                    oSelf._Tenant = hOpts.hQuery[oSelf.getSettings().sTenantProperty];

                async.series([
                    function(callback) {
                        Config.Redis.loadObject(hOpts,oSelf,callback);
                    }
                    ,function(callback) {
                        Config.MySql.loadObject(hOpts,oSelf,callback);
                    }
                    ,function(callback) {
                        if (!oSelf._Tenant && oSelf.getSettings().sTenantProperty && oSelf.get(oSelf.getSettings().sTenantProperty))
                            oSelf._Tenant = oSelf.get(oSelf.getSettings().sTenantProperty);

                        if (hOpts && hOpts.hExtras)
                            oSelf.loadExtras(hOpts.hExtras,callback);
                        else
                            callback();

                    }
                ],function(err){
                    //Config.debug(oSelf.sClass+ '('+oSelf.getKey()+') - '+oSelf.sSource);
                    fnCallback(err,oSelf);
                });
            } else {
                delete hOpts.hQuery;
            }
        } else if (hOpts instanceof Base) {
            oSelf.copyData(hOpts);
            if (oSelf.getSettings().sTenantProperty && oSelf.get(oSelf.getSettings().sTenantProperty))
                oSelf._Tenant = oSelf.get(oSelf.getSettings().sTenantProperty);
        } else {
            oSelf.setData(hOpts,true);
            if (oSelf.getSettings().sTenantProperty && oSelf.get(oSelf.getSettings().sTenantProperty))
                oSelf._Tenant = oSelf.get(oSelf.getSettings().sTenantProperty);
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

    ////Config.debug('Redis: loadExtras on '+oSelf.sClass+' ('+oSelf.getKey()+')');
    if (hExtras && hExtras instanceof Object && Object.keys(hExtras) && Object.keys(hExtras).length) {

        if (!oSelf._Tenant && oSelf.getSettings().sTenantProperty && oSelf.get(oSelf.getSettings().sTenantProperty))
            oSelf._Tenant = oSelf.get(oSelf.getSettings().sTenantProperty);

        var sSource = hExtras.sSource || oSelf.sSource;
        delete hExtras.sSource;

        // Used to load data into the extra, recursively as instructed in the hExtras directive.
        var loadExtra = function(hOpts,callback){

            if (hOpts && hOpts.hPropertyOpts && hOpts.sProperty) {

                var hSettings = hOpts.hSettings;
                var sProperty = hOpts.sProperty;

                if (!hSettings || !sProperty || !hSettings.hExtras || !hSettings.hExtras[sProperty])
                    callback('Trying to loadExtra on property that is not configured: '+sProperty+' on class: '+oSelf.sClass);
                else {
                    var sClass = hSettings.hExtras[sProperty].sClass;
                    if (sClass instanceof Function) sClass = sClass(oSelf,Config);

                    if (!sClass && hSettings.hExtras[sProperty].sType.match(/(Object|Collection)/))
                        callback();
                    else {
                        hOpts = (hOpts===true) ? {} : hOpts.hPropertyOpts;

                        // Queue up redis calls and mysql queries.
                        ////Config.debug(sProperty+': '+hSettings.hExtras[sProperty].sType);
                        switch (hSettings.hExtras[sProperty].sType) {
                            case 'Object':
                                if (oSelf[sProperty] && (oSelf[sProperty] instanceof Base) && oSelf[sProperty].getKey()) {
                                    oSelf[sProperty]._Tenant = oSelf._Tenant;

                                    if (hOpts.hExtras) {
                                        //Config.debug(oSelf.sClass+' ('+oSelf.getKey()+').'+sProperty+' loadExtras');
                                        oSelf[sProperty].loadExtras(hOpts.hExtras,callback);
                                    } else {
                                        //Config.debug(oSelf.sClass+' ('+oSelf.getKey()+').'+sProperty+' loadExtras SKIP');
                                        //if (!oSelf[sProperty].getKey()) //Config.debug('EXTRA NOT FOUND: '+sProperty+' ON '+oSelf.sClass+' ('+oSelf.getKey()+')');
                                        callback();
                                    }

                                } else {
                                    oSelf[sProperty] = Base.lookup({sClass:sClass});
                                    oSelf[sProperty]._Tenant = oSelf._Tenant;

                                    // Query will be the same for both Redis & MySql, using the numeric key as defined for the class.
                                    var hQuery;

                                    if (hSettings.hExtras[sProperty].fnQuery)
                                        hQuery = hSettings.hExtras[sProperty].fnQuery(oSelf,Config,sProperty);

                                    ////Config.debug(hQuery);
                                    var sExtraSource = (hOpts.hExtras && hOpts.hExtras.sSource) ? hOpts.hExtras.sSource : (hSettings.sSource) ? hSettings.sSource : hOpts.sSource;

                                    async.series([
                                        function(cback) {
                                            if (!hQuery && hSettings.hExtras[sProperty].fnQueryOverride) {
                                                //Config.debug(oSelf.sClass+' ('+oSelf.getKey()+').'+sProperty+' fnQueryOverride');
                                                hSettings.hExtras[sProperty].fnQueryOverride(oSelf[sProperty],oSelf,function(err,oObj){
                                                    if (!err)
                                                        oSelf[sProperty] = oObj;
                                                    cback(err);
                                                });
                                            } else {
                                                //Config.debug(oSelf.sClass+' ('+oSelf.getKey()+').'+sProperty+' fnQueryOverride SKIP');
                                                cback();
                                            }
                                        }
                                        // Try Redis (or config for sample objects).
                                        ,function(cback) {
                                            // If the hData is provided in the config (such as we do with stats), just load it.
                                            if (hQuery && !oSelf[sProperty].getKey()) {
                                                Config.Redis.loadObject({hQuery:hQuery,sSource:sExtraSource},oSelf[sProperty],cback);
                                            } else {
                                                cback();
                                            }
                                        }
                                        // Then try MySql if not found already.
                                        ,function(cback){
                                            if (hQuery && !oSelf[sProperty].getKey()) {
                                                //Config.debug(oSelf.sClass+' ('+oSelf.getKey()+').'+sProperty+' MySql.loadObject',hQuery);
                                                Config.MySql.loadObject({hQuery:hQuery,sSource:sExtraSource},oSelf[sProperty],cback);
                                            } else {
                                                //Config.debug(oSelf.sClass+' ('+oSelf.getKey()+').'+sProperty+' MySql.loadObject SKIP');
                                                cback();
                                            }
                                        }
                                        // Then load any extras.
                                        ,function(cback) {
                                            if (oSelf[sProperty].getKey() && hOpts.hExtras) {
                                                //Config.debug(oSelf.sClass+' ('+oSelf.getKey()+').'+sProperty+' loadExtras',hOpts.hExtras);
                                                oSelf[sProperty].loadExtras(hOpts.hExtras,cback);
                                            } else {
                                                //Config.debug(oSelf.sClass+' ('+oSelf.getKey()+').'+sProperty+' loadExtras SKIP');
                                                //if (!oSelf[sProperty].getKey()) //Config.debug('EXTRA NOT FOUND: '+sProperty+' ON '+oSelf.sClass+' ('+oSelf.getKey()+')');
                                                cback();
                                            }
                                        }
                                    ],callback);
                                }

                                break;
                            case 'Collection':

                                if (!Collection) Collection  = require('./Collection');
                                oSelf[sProperty] = new Collection({sClass:sClass});
                                oSelf[sProperty]._Tenant = oSelf._Tenant;

                                var nSize = (hOpts.hExtras && hOpts.hExtras.nSize) ? parseFloat(hOpts.hExtras.nSize) : (hOpts.nSize) ? parseFloat(hOpts.nSize) : 0;
                                var nFirstID = (hOpts.hExtras && hOpts.hExtras.nFirstID) ? parseFloat(hOpts.hExtras.nFirstID) : (hOpts.nFirstID) ? parseFloat(hOpts.nFirstID) : null;
                                var sFirstID = (hOpts.hExtras && hOpts.hExtras.sFirstID) ? hOpts.hExtras.sFirstID : (hOpts.sFirstID) ? hOpts.sFirstID : null;
                                var nMax = (hOpts.hExtras && hOpts.hExtras.nMax) ? parseFloat(hOpts.hExtras.nMax) : (hOpts.nMax) ? parseFloat(hOpts.nMax) : null;
                                var nMin = (hOpts.hExtras && hOpts.hExtras.nMin) ? parseFloat(hOpts.hExtras.nMin) : (hOpts.nMin) ? parseFloat(hOpts.nMin) : null;
                                var bReverse = (hOpts.hExtras && hOpts.hExtras.bReverse) ? hOpts.hExtras.bReverse : (hOpts.bReverse) ? hOpts.bReverse : (hSettings.hExtras[sProperty].bReverse) ? hSettings.hExtras[sProperty].bReverse : false;
                                var sOrderBy = (hOpts.hExtras && hOpts.hExtras.sOrderBy) ? (hOpts.hExtras.sOrderBy) : (hOpts.sOrderBy) ? hOpts.sOrderBy : (hSettings.hExtras[sProperty].sOrderBy) ? hSettings.hExtras[sProperty].sOrderBy : '';
                                var sExtraSource = (hOpts.hExtras && hOpts.hExtras.sSource) ? hOpts.hExtras.sSource : (hSettings.hExtras[sProperty].sSource) ? hSettings.hExtras[sProperty].sSource : (hSettings.sSource) ? hSettings.sSource : hOpts.sSource;


                                var hQuery = (hSettings.hExtras[sProperty].fnQuery) ?  hSettings.hExtras[sProperty].fnQuery(oSelf,Config,sProperty) : null;
                                if (hSettings.hExtras[sProperty].fnQueryOverride) {
                                    var hCustom = hSettings.hExtras[sProperty].fnQueryOverride(oSelf,Config);
                                    if (hCustom.hQuery) {
                                        hQuery = hCustom.hQuery;
                                        delete hCustom.hQuery;
                                    }
                                    if (nMax==undefined && hCustom.nMax != undefined) nMax = hCustom.nMax;
                                    if (nMin==undefined && hCustom.nMin != undefined) nMin = hCustom.nMin;
                                    if (bReverse==undefined && hCustom.bReverse != undefined) bReverse = hCustom.bReverse;
                                }

                                async.series([
                                    function(cback) {
                                        if (hQuery && oSelf.getKey()) {
                                            Config.Redis.loadCollection({
                                                sKey:oSelf.getRedisKey()+':'+sProperty
                                                ,sSource:sExtraSource
                                                ,bReverse:bReverse
                                                ,sOrderBy:sOrderBy
                                                ,nSize:nSize
                                                ,sFirstID:sFirstID||nFirstID
                                                ,nMax:nMax
                                                ,nMin:nMin
                                            },oSelf[sProperty],cback);
                                        } else
                                            cback();
                                    }
                                    ,function(cback){
                                        if (hQuery && sExtraSource != 'Redis' && oSelf[sProperty].sSource != 'Redis' && oSelf.getKey() && (!oSelf[sProperty] || !oSelf[sProperty].nTotal)) {
                                            Config.MySql.loadCollection({
                                                hQuery:hQuery
                                                ,bReverse:bReverse
                                                ,sOrderBy:sOrderBy
                                                ,sSource:sExtraSource
                                                ,nSize:nSize
                                                ,sFirstID:(sFirstID || nFirstID)
                                                ,nMax:nMax
                                                ,nMin:nMin
                                            }, oSelf[sProperty], cback);

                                        } else {
                                            cback();
                                        }
                                    }
                                    ,function(cback){
                                        if (!hOpts || !hOpts.hExtras || !oSelf[sProperty].aObjects || !oSelf[sProperty].aObjects.length)
                                            cback();
                                        else {

                                            var n = -1;
                                            oSelf[sProperty].forEach(function(oItem,cb){
                                                n++;
                                                oSelf[sProperty].aObjects[n] = oItem;
                                                oSelf[sProperty].aObjects[n].loadExtras(hOpts.hExtras,cb);
                                            },cback);

                                        }
                                    }
                                    ,function(cback) {
                                        if (hOpts && hOpts.hExtras && hOpts.hExtras.nSize)
                                            oSelf[sProperty].nSize = hOpts.hExtras.nSize;
                                        else if (hOpts && hOpts.nSize)
                                            oSelf[sProperty].nSize = hOpts.nSize;

                                        cback();
                                    }
                                ],function(){
                                    callback();
                                });

                                break;
                            case 'Hash':case 'Array':
                                oSelf[sProperty] = (hSettings.hExtras[sProperty].sType=='Array') ? [] : null;
                                if (hSettings.hExtras[sProperty].fnQuery) {
                                    if (hSettings.hExtras[sProperty].bCallback) {
                                        hSettings.hExtras[sProperty].fnQuery(oSelf,Config,function(){
                                            callback();
                                        });
                                    } else {
                                        hSettings.hExtras[sProperty].fnQuery(oSelf,Config);
                                        callback();
                                    }
                                } else
                                    callback();
                                break;
                            case 'Boolean':
                                oSelf[sProperty] = false;
                                if (hSettings.hExtras[sProperty].fnQuery) {
                                    if (hSettings.hExtras[sProperty].bCallback)
                                        hSettings.hExtras[sProperty].fnQuery(oSelf,Config,callback);
                                    else {
                                        hSettings.hExtras[sProperty].fnQuery(oSelf,Config);
                                        callback();
                                    }
                                } else
                                    callback();
                                break;
                            default:
                                callback();
                                break;
                        }
                    }
                }
                
            } else
                callback();
        };

        // If we have any extras to load, it will be in the hExtras directive of the passed-in options.
        async.each(Object.keys(hExtras),function(sProperty,cb){
            
            if (sProperty && !sProperty.match(/^(nFirstID|sFirstID|nMax|nMin|nSize|sView|sSource)$/)) {

                var id = oSelf.sClass+'.'+(oSelf.getKey()||'')+'.'+sProperty;
                if (Config.logger.level.match(/^(debug|silly)$/)) {
                    if (!oSelf._Timers) oSelf._Timers = {};
                    oSelf._Timers[id] = setTimeout(function(){
                        Config.fatal('Extra never loaded: '+id);
                    },30000);
                }

                loadExtra({
                    sProperty:sProperty,
                    hPropertyOpts:hExtras[sProperty],
                    hSettings:oSelf.getSettings()
                },function(err){
                    if (Config.logger.level.match(/^(debug|silly)$/))
                        clearTimeout(oSelf._Timers[id]);
                    async.setImmediate(cb);
                });
            } else
                async.setImmediate(cb);

        },function(err){
            if (fnCallback)
                async.setImmediate(function(){
                    fnCallback(err, oSelf);
                });
        });

    } else if (fnCallback) {
        async.setImmediate(function(){
            fnCallback(null, oSelf);
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
                if (Config.hClasses[oSelf.sClass] && Config.hClasses[oSelf.sClass].hProperties && Config.hClasses[oSelf.sClass].hProperties[sProp])
                    oSelf.set(sProp,hData[sProp],bIgnoreDelta);
                else if (Config.hClasses[oSelf.sClass] && Config.hClasses[oSelf.sClass].hExtras && Config.hClasses[oSelf.sClass].hExtras[sProp])
                    oSelf[sProp] = hData[sProp];
//                else
//                    console.warn('No hProperties found on '+oSelf.sClass+'?',Config.hClasses);
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
    if (sProperty && this.hData && this.getSettings().hProperties[sProperty] && !this.getSettings().hProperties[sProperty].bReadOnly) {
        var oldVal = this.hData[sProperty];
        switch (this.getSettings().hProperties[sProperty].sType) {
            case 'Boolean':
                oldVal = (oldVal===false || oldVal===true) ? oldVal : validator.toBoolean(oldVal);
                this.hData[sProperty] = (value===false || value===true) ? value : validator.toBoolean(value);
                break;
            case 'Number':case 'Timestamp':case 'Float':
                if (isNaN(parseFloat(this.hData[sProperty]))===false)
                    oldVal = parseFloat(this.hData[sProperty]);
                if (isNaN(parseFloat(value))===false || value===null)
                    this.hData[sProperty] = (value===null) ? null : parseFloat(value);
                break;
            case 'Decimal':
                var scale = Number(this.getSettings().hProperties[sProperty].nScale);
                var y = '1';
                for (var i = scale; i > 0; i--) {
                    y += '0';
                }
                y = Number(y);
                this.hData[sProperty] = parseFloat(Math.round(value * y) / y).toFixed(scale);
                break;
            default:
                this.hData[sProperty] = value||'';
                break;
        }

        if (!this._Tenant && this.hData[sProperty] && this.getSettings().sTenantProperty && sProperty == this.getSettings().sTenantProperty)
            this._Tenant = this.hData[sProperty];

        if (!bIgnoreDelta && this.getKey() && oldVal != this.hData[sProperty] && !this.getSettings().hProperties[sProperty].bPrimary ) {
            if (!this.hDelta) this.hDelta = {};
            this.hDelta[sProperty] = {
                old:oldVal,
                new:this.hData[sProperty]
            };
        }
    }
};
/**
 * Set a key-value on a hash.
 * @param sProperty
 * @param sKey
 * @param Value
 */
p.setHashKey = function(sProperty,sKey,Value) {
    this.getHash(sProperty)[sKey] = Value;
    this.set(sProperty,JSON.stringify(this.getHash(sProperty)));
};
/**
 * Allows code to set entire hash in non-destructive way and only cause hDelta if something actually changes.
 * @param hNew - Hash to use to append to the current hash already existant on the object.
 */
p.setHashAppendOnly = function(sProp,hNew) {
    var oSelf = this;
    var hOld = {};
    try {
        hOld = JSON.parse(oSelf.get(sProp));
    } catch (er) {
        hOld = {};
    }
    var n = 0;

    (function updateHash(hN,hO) {
        for (var sKey in hN) {
            
            switch (Object.prototype.toString.call(hN[sKey])) {
                case '[object String]': case '[object Number]':

                    if (hN[sKey] != hO[sKey] && (hN[sKey] || hO[sKey])) {
                        hO[sKey] = hN[sKey];
                        n++;
                    }

                    break;
                case '[object Array]':

                    if (!hO[sKey]) hO[sKey] = [];
                    if (hO[sKey].length != hN[sKey].length) {
                        hO[sKey] = hN[sKey];
                        n++;
                    } else {
                        for (var i = 0; i < hN[sKey].length; i++) {
                            if (JSON.stringify(hN[sKey][i]) != JSON.stringify(hO[sKey][i])) {
                                hO[sKey][i] = hN[sKey][i];
                                n++;
                            }
                        }
                    }

                    break;
                case '[object Object]':

                    if (!hO[sKey]) hO[sKey] = {};
                    updateHash(hN[sKey], hO[sKey]);

                    break;
            }
        }
    })(hNew,hOld);
    if (n) oSelf.set('sMeta',JSON.stringify(hOld));
    return n;
};
/**
 * Pulls the hash-based property and deletes a key from it, and resaves the property.
 * @param sProperty
 * @param sKey
 */
p.deleteHashKey = function(sProperty,sKey) {
    if (this.getHash(sProperty)[sKey] != undefined) delete this.getHash(sProperty)[sKey];
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
                return validator.toBoolean(oSelf.hData[sProperty]);
                break;
            case 'String':
                return oSelf.hData[sProperty] || '';
                break;
            case 'Number':case 'Timestamp':case 'Float':
                if (isNaN(parseFloat(oSelf.hData[sProperty]))===false)
                    return parseFloat(oSelf.hData[sProperty]);
                else
                    return null;
                break;
            case 'Decimal':
                return parseFloat(oSelf.hData[sProperty]).toFixed(oSelf.getSettings().hProperties[sProperty].nScale);
                break;
            default:
                return oSelf.hData[sProperty];
                break;
        }
    } else {
        return null;
    }
};
/**
 * This retrieves the property hash and a particular key on that hash.
 * @param sProperty
 * @param sKey
 * @returns {*}
 */
p.getHashKey = function(sProperty,sKey) {
    return this.getHash(sProperty)[sKey];
};
/**
 * Allows the use of a single data field as a json-formatted hash. This retrieves and parses it.
 * @param sProperty
 * @returns {*}
 */
p.getHash = function(sProperty,bForce) {
    var oSelf = this;
    var sHashProp = 'h'+sProperty.substring(1);
    if (oSelf.get(sProperty) && (bForce || !oSelf[sHashProp] || !Object.keys(oSelf[sHashProp]).length))
        try {
            oSelf[sHashProp] = JSON.parse(oSelf.get(sProperty));
        } catch (er) {
            oSelf[sHashProp] = {};
        }
    else if (!oSelf[sHashProp]) {
        oSelf[sHashProp] = {};
    }
    return oSelf[sHashProp];
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
        this.set(this.getSettings().sCreateTimeProperty,moment.utc().valueOf());
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
    if (this.getSettings().sUpdateTimeProperty && (!this.hDelta || !this.hDelta[this.getSettings().sUpdateTimeProperty]))
        this.set(this.getSettings().sUpdateTimeProperty,moment.utc().valueOf(),true);
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
            var nTTL = (hSettings.nTTL) ? hSettings.nTTL : (Config.hClasses[hSettings.sClass] && Config.hClasses[hSettings.sClass].nTTL) ? Config.hClasses[hSettings.sClass].nTTL : oSelf.getSettings().nTTL;
            if (Config.hClasses[hSettings.sClass] && Config.hClasses[hSettings.sClass].sSource)
                hSettings.sSource = Config.hClasses[hSettings.sClass].sSource;
            var sKey = oSelf.getRedisKey() + ':' + sProperty;

            async.series([
                function(callback) {
                    if (!oSelf.getKey() && oSelf.get(oSelf.getSettings().sStrKeyProperty)) {
                        // Allow the creation of an object using only a secondary lookup key.
                        var hQuery = {};
                        hQuery[oSelf.getSettings().sStrKeyProperty] = oSelf.get(oSelf.getSettings().sStrKeyProperty);
                        Base.lookup({sClass:oSelf.sClass,hQuery:hQuery},function(err,oResult){
                            oSelf.hData = oResult.hData;
                            if (!oSelf.getKey())
                                callback('skip');
                            else
                                callback(err);
                        });
                    } else
                        callback();
                }
                ,function(callback){
                    if (Value instanceof Base && !Value.getKey())
                        Value.save({nTTL:nTTL}, callback);
                    else
                        callback(null, Value);
                }
                ,function(callback) {
                    if (oSelf.getKey()) {
                        switch (hSettings.sType) {
                            case 'Collection':
                                // If the collection doesn't yet exist, instantiate it.
                                if (!oSelf[sProperty] || (oSelf[sProperty] instanceof Collection)==false) {
                                    if (!Collection) Collection = require('./Collection');
                                    oSelf[sProperty] = new Collection({sClass:hSettings.sClass});
                                }
                                if (oSelf._Tenant) oSelf[sProperty]._Tenant = oSelf._Tenant;

                                // Don't save it again if it doesn't need saving.
                                oSelf[sProperty].add(Value);

                                if ((Value instanceof Base)===false)
                                    Value = Base.lookup({sClass:hSettings.sClass,hData:Value});

                                var sOrderBy = (hSettings.fnOrderBy) ? hSettings.fnOrderBy(Value) : hSettings.sOrderBy;
                                if (Value instanceof Base) {
                                    if (hSettings.sSource != 'MySql') {
                                        Config.Redis.addToSet({
                                            sKey:sKey,
                                            nTTL:nTTL,
                                            sOrderBy:sOrderBy
                                        }, Value, callback);
                                    } else
                                        callback();
                                } else
                                    callback();

                                break;
                            case 'Object':
                                oSelf[sProperty] = Value;
                                if (oSelf._Tenant) oSelf[sProperty]._Tenant = oSelf._Tenant;
                                callback();
                                break;
                            default:
                                callback();
                                break;
                        }
                    } else
                        callback();

                }
                // ,function(callback) {
                //     if (sKey && oSelf[sProperty] && hSettings.sType=='Collection') {
                //         Config.Redis.hset(oSelf[sProperty].getRedisKey(null, true) + ':STATUS', sKey, 1, callback);
                //     } else
                //         callback();
                // }
            ],function(err){
                if (fnCallback)
                    async.setImmediate(function(){
                        fnCallback((err && err=='skip') ? '' : err);
                    });
            });
        }
    } else if (fnCallback)
        async.setImmediate(function(){
            fnCallback();
        });
};
/**
 * Removes extra from the object or collection.
 * @param sProperty
 * @param Value
 * @param fnCallback
 */
p.deleteExtra = function(sProperty,Value,fnCallback) {
    var oSelf = this;
    if (oSelf && oSelf.getKey() && sProperty && Value && Value instanceof Base) {
        async.series([
            function(callback) {
                // Locate the hExtras settings for this class.
                var hSettings = oSelf.getSettings().hExtras[sProperty];

                switch (hSettings.sType) {
                    case 'Collection':
                        // Don't save it again if it doesn't need saving.
                        var sOrderBy = (hSettings.fnOrderBy) ? hSettings.fnOrderBy(Value) : hSettings.sOrderBy;
                        async.parallel([
                            function(cb) {
                                // Iterate through the collection and remove the item.
                                if (oSelf[sProperty] && oSelf[sProperty] instanceof Collection && oSelf[sProperty].nTotal) {
                                    if (oSelf._Tenant) oSelf[sProperty]._Tenant = oSelf._Tenant;
                                    var n = 0;
                                    for (var n = (oSelf[sProperty].aObjects.length-1); n >= 0; n--) {
                                        var oItem = oSelf[sProperty].getItem(n);
                                        if (oItem && oItem.getKey() == Value.getKey()) {
                                            oSelf[sProperty].aObjects.splice(n,1);
                                            oSelf[sProperty].nTotal--;
                                            oSelf[sProperty].nCount--;
                                            oSelf[sProperty].reset();
                                            break;
                                        }
                                    }
                                    cb();
                                } else
                                    cb();
                            }
                            ,function(cb){
                                Config.Redis.removeFromSet({
                                    sKey:oSelf.getRedisKey() + ':' + sProperty,
                                    sOrderBy:sOrderBy
                                }, Value, cb);
                            }
                        ],callback);
                        break;
                    default:
                        delete oSelf[sProperty];
                        callback();
                        break;
                }
            }
        ],function(err){
            if (fnCallback) fnCallback(err);
        });
    } else if (fnCallback)
        fnCallback();
};
/**
 * The save method handles a few items: 1) It checks for duplicates on new item creation,
 * 2) It assigns nID on new item creation (if using Redis as primary data store), and 3) does
 * the actual save of the object.
 *
 * @param hOpts
 * @param fnCallback
 */
p.save = function(hOpts,fnCallback,fnAdapterCallback) {
    var oSelf = this;
    // Set sID if needed
    if (arguments[0] instanceof Function) {
        fnCallback = arguments[0];
        hOpts = undefined;
    }
    if (!oSelf.getKey()) oSelf.bNew = true;
    if (oSelf.getSettings().sStrKeyProperty && !oSelf.get(oSelf.getSettings().sStrKeyProperty) && oSelf.getSettings().hProperties[oSelf.getSettings().sStrKeyProperty].nLength) {
        oSelf.set(oSelf.getSettings().sStrKeyProperty,Str.getSID(oSelf.getSettings().hProperties[oSelf.getSettings().sStrKeyProperty].nLength));
        if (oSelf.getSettings().hProperties[oSelf.getSettings().sStrKeyProperty].bPrimary)
            oSelf.bNew = true;
    }

    var bNew = (oSelf.bNew==true);
    var hDelta = (oSelf.hDelta) ? JSON.parse(JSON.stringify(oSelf.hDelta)) : null;
    var bRemoved = (oSelf.bRemoved==true);
    if (hOpts && hOpts.bForce) oSelf.bForce = true;

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
                    callback('Must set required properties on '+oSelf.sClass+': '+oSelf.getSettings().aRequiredProperties.join(','));
                else
                    callback();
            } else
                callback();
        }
        ,function(callback) {
            oSelf.setID(callback);
        }
        ,function(callback) {
            if (hDelta && Object.keys(hDelta) && Object.keys(hDelta).length)
                oSelf.setUpdateTime();
            callback();
        }
        ,function(callback) {
            if (oSelf.hDelta || oSelf.bNew || (hOpts && hOpts.bForce)) {
                Config.Redis.saveObject(hOpts, oSelf, callback);
            } else
                callback();
        }
        ,function(callback) {
            if (oSelf.hDelta || oSelf.bNew || (hOpts && hOpts.bForce)) {
                Config.MySql.saveObject(hOpts,oSelf,callback);
            } else
                callback();
        }
        ,function(callback) {
            if (bNew || (hDelta && Object.keys(hDelta).length) || bRemoved) {
                oSelf.processExtras(bNew,hDelta,bRemoved,callback);
            } else
                callback();
        }
        ,function(callback) {
            if (hOpts && hOpts.bWaitForAdapter)
                oSelf.publish(bNew,hDelta,bRemoved,callback);
            else {
                oSelf.publish(bNew,hDelta,bRemoved);
                callback();
            }
        }
    ],function(err){
        oSelf.clean();
        if (fnCallback)
            async.setImmediate(function(){
                fnCallback(err,oSelf);
            });
    });
};
/**
 * This method assigns a primary key id to the object using Redis' incrby method.
 * @param fnCallback
 */
p.setID = function(fnCallback) {
    var oSelf = this;
    // We always track when the item was created and last updated.
    if (!oSelf.getKey()) {
        oSelf.bNew = true;
        oSelf.setCreateTime();
        oSelf.setUpdateTime();
        if (!oSelf.getSettings().bAutoIncrementKey)
            Config.Redis.getNextID(oSelf,fnCallback);
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
    return Config.getClasses(this.sClass) || {};
};
/**
 * This method is used for namespacing classes. If the class is configured with an nClass prorperty we use it.
 * Using an nClass allows easy renaming of classes and smaller key-space use in redis.
 */
p.getClass = function(){
    return this.getSettings().nClass || this.sClass;
};

p.getRedisKey = function(sKeyValue,bSkip) {
    var oSelf = this;
    var _sRedisKey = oSelf.nClass || oSelf.getSettings().nClass || oSelf.sClass;

    if (oSelf._Tenant && oSelf.getSettings().sTenantProperty) _sRedisKey += ':'+oSelf._Tenant;

    if (sKeyValue)
        _sRedisKey += ':'+sKeyValue
    else if (!bSkip)
        _sRedisKey += ':'+oSelf.getKey();

    return _sRedisKey;
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
                Config.Redis.deleteObject(oSelf,callback);
            }
            ,function(callback) {
                Config.MySql.deleteObject(oSelf,callback);
            }
            ,function(callback) {
                oSelf.processExtras(null,null,true);
                callback();
            }
        ],function(err){
            oSelf.bRemoved = true;
            oSelf.publish(false,null,true);

            if (fnCallback)
                setImmediate(function(){
                    fnCallback(err,oSelf);
                });
        });
    } else if (fnCallback) {
        setImmediate(function(){
            fnCallback(null,oSelf);
        });
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
p.toHash = function(hExtras,bPrivate) {
    var oSelf = this;
    var hResult = {sClass:oSelf.sClass,nClass:oSelf.nClass};
    if (oSelf.getKey()) {
        oSelf.getSettings().aProperties.forEach(function(sProp){
            if (!oSelf.getSettings().hProperties[sProp].bPrivate || bPrivate)
                hResult[sProp] = oSelf.get(sProp);
        });

        if (hExtras) {
            for (var sProp in hExtras) {
                if (oSelf[sProp] && oSelf[sProp] instanceof Base) {
                    hResult[sProp] = oSelf[sProp].toHash(hExtras[sProp].hExtras,hExtras[sProp].sPath,hExtras[sProp].nSize);
                } else {
                    hResult[sProp] = oSelf[sProp];
                }
            }
        }
        if (oSelf.bRemoved)
            hResult.bRemoved = true;
    }
    return hResult;
};

p.toSampleHash = function() {
    var oSelf = this;
    for (var sProp in Config.getClasses(oSelf.sClass).hProperties) {
        if (Config.getClasses(oSelf.sClass).hProperties[sProp].sSample != undefined)
            oSelf.set(sProp,Config.getClasses(oSelf.sClass).hProperties[sProp].sSample,true);
    }
    return oSelf.toHash();
};

p.publish = function(bNew,hDelta,bRemoved,fnAdapterCallback) {
    var oSelf = this;
    // Delete bNew, bQueue hDelta because we've logged it and don't want to do it again.
    oSelf.clean();
    // If the class has an adapter configured, then we'll call its handle method.
    if (Config.hClasses[oSelf.sClass].sAdapterPath && (bNew || hDelta || bRemoved))
        oSelf.handle(bNew,hDelta,bRemoved,null,function(err){
            if (fnAdapterCallback) fnAdapterCallback();
        });
    else if (fnAdapterCallback)
        fnAdapterCallback();
};

p.processExtras = function(bNew,hDelta,bRemoved,fnCallback) {
    var oSelf = this;

    if (!oSelf._Tenant && oSelf.getSettings().sTenantProperty && oSelf.get(oSelf.getSettings().sTenantProperty))
        oSelf._Tenant = oSelf.get(oSelf.getSettings().sTenantProperty);


    // See if this item belongs in an 'extra' on another-related class.
    if (Config.hExtrasByClass[oSelf.sClass])
        async.each(Config.hExtrasByClass[oSelf.sClass],function(hOpts,callback) {
            var done = function(){
                async.setImmediate(callback);
            }
            // Simulate the parent using the fnCreate in the extra. The fnCreate can return a single hash or
            // an array of hashes - each provides the primary key id to instantiate enough of the parent object
            // to call its setExtra or deleteExtra method.
            Config.hClasses[hOpts.sParent].hExtras[hOpts.sExtra].fnCreate(oSelf,Config,bNew,hDelta,bRemoved,function(err,data){
                if (!data || (data instanceof Array && !data.length))
                    done();
                else if (data instanceof Array) {
                    async.each(data,function(hItem,cb){
                        var oParent = Base.lookup({sClass:hOpts.sParent,hData:hItem,_Tenant:oSelf._Tenant});
                        if (!oParent.getKey()) {
                            async.setImmediate(cb);
                        } else if (bRemoved)
                            oParent.deleteExtra(hOpts.sExtra,oSelf,function(){
                                async.setImmediate(cb);
                            });
                        else
                            oParent.setExtra(hOpts.sExtra,oSelf,function(){
                                async.setImmediate(cb);
                            });
                    },done);
                } else {
                    var oParent = Base.lookup({sClass:hOpts.sParent,hData:data,_Tenant:oSelf._Tenant});

                    if (!oParent.getKey()) {
                        done();
                    } else if (bRemoved)
                        oParent.deleteExtra(hOpts.sExtra, oSelf,done);
                    else {
                        oParent.setExtra(hOpts.sExtra, oSelf, done);
                    }
                }
            });

        }, function(err){
            if (fnCallback) async.setImmediate(function(){fnCallback(err)});
        });
    else if (fnCallback)
        fnCallback();
};

p.handle = function(bNew,hDelta,bRemoved,sCustomPath,fnAdapterCallback){
    var oSelf = this;
    // Once the handler is loaded, we don't need to do it again. So see if it is loaded in the cache.
    var sAdapterPath = (sCustomPath) ? sCustomPath : (Config.NORDIS_ENV_ROOT_DIR) ? Config.NORDIS_ENV_ROOT_DIR+Config.hClasses[oSelf.sClass].sAdapterPath   : Config.hClasses[oSelf.sClass].sAdapterPath;

    var Handler = (sAdapterPath) ? require.cache[sAdapterPath] : null;
    if (sAdapterPath && !Handler) {
        // Check for overrides and adapters.
        try {
            var Handler = require(sAdapterPath);
        } catch (err) {
            Config.error('Error when attempting to require adapter for class '+oSelf.sClass+' at path '+sAdapterPath.toString());
            Config.error(sAdapterPath);
        } finally {
            if (Handler && !Handler.handle)
                Config.error('Adapter for '+oSelf.sClass+' does not have a handle method: module.exports.handle = function(bNew,hDelta,bRemoved,oObj){}; ',sAdapterPath);
        }
    }

    if (Handler) {
        if (Handler.handle)
            Handler.handle(bNew,hDelta,bRemoved,oSelf,fnAdapterCallback);
        else if (Handler.exports.handle)
            Handler.exports.handle(bNew,hDelta,bRemoved,oSelf,fnAdapterCallback);
        else if (fnAdapterCallback)
            fnAdapterCallback();
    } else if (fnAdapterCallback)
        fnAdapterCallback();
};

p.getEscaped = function(sProperty){
    var oSelf = this;
    if (oSelf.hData && sProperty) {
        switch (sProperty.toString().substring(0,1)) {
            case 'n':
                // But we need to preserve nulls.
                if (isNaN(parseFloat(oSelf.hData[sProperty]))===false)
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
        hOpts.sClass = Config.getClassMap(hOpts.nClass);

    if (Config.getClasses(hOpts.sClass) && Config.getClasses(hOpts.sClass).sClassPath) {
        var sClassPath = (Config.getEnv('NORDIS_ENV_ROOT_DIR')) ? Config.getEnv('NORDIS_ENV_ROOT_DIR') + Config.getClasses(hOpts.sClass).sClassPath  : Config.getClasses(hOpts.sClass).sClassPath;
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
        });
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
 * Promise-based REST request method. This method assumes a JSON-formatted response on success.
 */
module.exports.requestP = function(method,url,data,headers) {
    //Config.debug(method+' - '+url);

    if (method.toLowerCase()=='delete') method = 'del';
    return new promise(function (resolve, reject) {
        var options = {form:data,headers:headers};
        if (method.toLowerCase()=='get')
            options = {qs:data,headers:headers};
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
            } else {
                try {
                    resolve(JSON.parse(body));
                } catch (err) {
                    resolve(body);
                }
            }
        });
    });
};

module.exports.request = function(method,url,data,callback) {
    //Config.debug(method+' - '+url);

    if (method.toLowerCase()=='delete') method = 'del';
    var options = {form:data};
    if (method.toLowerCase()=='get')
        options = {qs:data};

    request[method.toLowerCase()](url,options, function (err, res, body) {
        if (err) {
            callback(err);
        } else if (res.statusCode !== 200) {
            if (body && body.match(/\{/))
                return callback(JSON.parse(body)); // Handles passing json response in exceptions.
            else if (body)
                return callback(body);
            else
                return callback(res);
        } else {
            try {
                callback(null,JSON.parse(body));
            } catch (err) {
                callback(null,body);
            }
        }
    });
}