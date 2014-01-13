var validator   = require('validator'),
    App         = require('./AppConfig'),
    String      = require('./Utils/String'),
    async       = require('async');

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
            delete hOpts.hQuery;
            App.error('Must supply either nClass or sClass to create an object, and set classes properly in configuration. '+JSON.stringify(hOpts));
        }

        var lookup = function(cb){
            oSelf.sSource = (hOpts.sSource) ? hOpts.sSource : (hOpts && hOpts.sSource=='Redis' && hOpts.sSource!='MySql') ? 'Redis' : ((!hOpts || !hOpts.hQuery.sWhere) && !App.Redis.hOpts.bSkip) ? 'Redis' : 'MySql';
            async.waterfall([
                function(callback) {
                    if (oSelf.sSource == 'Redis') {
                        App.Redis.loadObject(hOpts,oSelf,callback);
                    } else {
                        callback(null,null);
                    }
                }
                ,function(oObj,callback) {
                    if (!App.MySql.hOpts.bSkip && (oSelf.sSource == 'MySql' || !oSelf.getNumKey())) {
                        App.MySql.loadObject(hOpts,oSelf,callback);
                    } else {
                        App.debug('App.MySql.hOpts.bSkip:'+App.MySql.hOpts.bSkip);
                        callback(null,oSelf);
                    }
                }
                ,function(oObj,callback) {
                    if (!oObj.getNumKey() && App.hClasses[oSelf.sClass].hProperties[App.hClasses[oSelf.sClass].sNumKeyProperty].nValue) {
                        if (fnCallback) {
                            oSelf.set(oSelf.getSettings().sNumKeyProperty,App.hClasses[oSelf.sClass].hProperties[App.hClasses[oSelf.sClass].sNumKeyProperty].nValue);
                            callback(null,oSelf);
                        } else
                            callback('This is a singleton instance. You must supply a callback when creating an instance of this class.');
                    } else
                        callback(null,oSelf);
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
        } else if (App.hClasses[oSelf.sClass].hProperties[App.hClasses[oSelf.sClass].sNumKeyProperty].nValue) {
            // It is possible to configure a singleton class by assigning the primary key id value of the class in config.
            // This means that only one instance of the class can exist, and it will be given the assigned nValue.
            // This is used primarily by the 'App' class, onto which we store analytics.
            hOpts.hQuery = {};
            hOpts.hQuery[App.hClasses[oSelf.sClass].sNumKeyProperty] = App.hClasses[oSelf.sClass].hProperties[App.hClasses[oSelf.sClass].sNumKeyProperty].nValue;
            lookup(fnCallback);
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
                App.info('Load '+sProperty+' ('+(sClass||'')+' '+hSettings.hExtras[sProperty].sType+') on '+oParent.sClass+' ('+oParent.getNumKey()+')');

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

                var sKey = (oParent.getNumKey()) ? oParent.nClass+':'+oParent.getNumKey()+':'+sProperty : null;

                // We'll load a redis & mysql connection, but only when needed and only once.
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
                                // Query will be the same for both Redis & MySql, using the numeric key as defined for the class.
                                var hQuery = (hSettings.hExtras[sProperty].aKey && oParent.get(hSettings.hExtras[sProperty].aKey[0])) ? {} : null;
                                if (hQuery) hQuery[oParent[sProperty].getSettings().sNumKeyProperty] = oParent.get(hSettings.hExtras[sProperty].aKey[0]);

                                async.waterfall([
                                    function(cback) {
                                        if (sSource == 'Redis' && hQuery && !App.Redis.hOpts.bSkip)
                                            loadClient('Redis',function(err){
                                                if (err)
                                                    cback(err);
                                                else
                                                    App.Redis.loadObject({hQuery:hQuery},oParent[sProperty],cback,hClients.Redis);
                                            });
                                        else
                                            cback(null,null);
                                    }
                                    ,function(res,cback){
                                        if (!res && hQuery && !App.MySql.hOpts.bSkip)
                                            loadClient('MySql',function(err){
                                                if (err)
                                                    cback(err);
                                                else
                                                    App.MySql.loadObject({hQuery:hQuery},oParent[sProperty],cback,hClients.MySql);
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

                                if (!oParent[sProperty].hQuery)

                                if (sSource != 'MySql' && !App.MySql.hOpts.bSkip && oParent[sProperty].hQuery && oParent[sProperty].hQuery.sWhere)
                                    sSource = 'MySql';

                                async.waterfall([
                                    function(callback){
                                        if (sSource == 'MySql')
                                            callback();
                                        else
                                            loadClient('Redis',callback);
                                    }
                                    ,function(callback){
                                        if (sSource == 'MySql' || App.Redis.hOpts.bSkip)
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

                                        if (nTotal || App.MySql.hOpts.bSkip) {
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
                                                        async.forEachLimit(aResult,100,loadItem,cb);
                                                    };

                                                    if (oParent[sProperty].bReverse)
                                                        hClients.Redis.zrevrange(sKey,oParent[sProperty].nStart,oParent[sProperty].nEnd,handleResult);
                                                    else
                                                        hClients.Redis.zrange(sKey,oParent[sProperty].nStart,oParent[sProperty].nEnd,handleResult);
                                                }
                                            ],callback);

                                        } else  {
                                            // Only if Redis has NOTHING do we try mysql on collections.
                                            loadClient('MySql',function(err){
                                                if (err)
                                                    callback(err);
                                                else {
                                                    App.MySql.loadCollection({
                                                        hQuery:hSettings.hExtras[sProperty].fnQuery(oParent,App,sProperty)
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

    var aProps = [];
    // If we have any extras to load, it will be in the hExtras directive of the passed-in options.
    for (var sProperty in hExtras) {
        aProps.push({
            oParent:oSelf,
            sProperty:sProperty,
            hPropertyOpts:hExtras[sProperty],
            hSettings:oSelf.getSettings()
        });
    }

    async.forEachLimit(aProps,3,loadExtra,function(err){
        if (hClients)
            for (var sSource in hClients) {
                if (App[sSource] && hClients[sSource]) {
                    App[sSource].release(hClients[sSource]);
                }
            }
        fnCallback(err,oSelf);
    });
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
    var oldVal = this.hData[sProperty];
    if (this.getSettings().hProperties[sProperty]) {
        switch (this.getSettings().hProperties[sProperty].sType) {
            case 'Boolean':
                this.hData[sProperty] = validator.toBoolean(value);
                break;
            case 'Number':case 'Timestamp':
                this.hData[sProperty] = this.toNumber(value);
                break;
            case 'Float':
                this.hData[sProperty] = parseFloat(Math.round(value * 100) / 100).toFixed(this.getSettings().hProperties[sProperty].nScale);
                break;
            default:
                this.hData[sProperty] = value||'';
                break;
        }
        if (!bIgnoreDelta && this.getNumKey() && oldVal != this.hData[sProperty] && sProperty != this.getSettings().sNumKeyProperty && sProperty != this.getSettings().sStrKeyProperty) {
        if (!this.hDelta) this.hDelta = {};
        this.hDelta[sProperty] = {
            old:oldVal,
            new:this.hData[sProperty]
        };
    }
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
    if (oSelf.hData && sProperty && oSelf.getSettings().hProperties[sProperty]) {
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
            default:
                return oSelf.hData[sProperty];
                break;
        }
    } else {
        App.debug('NOT FOUND: '+sProperty);
        App.debug(oSelf.hData);
        App.debug(oSelf.getSettings().hProperties);
        return null;
    }
};
/**
 * Shortcut mechanism for pulling the object's integer primary key value using
 * the sNumKeyProperty property name as defined in config.
 */
p.getNumKey = function(){
    return this.get(this.getSettings().sNumKeyProperty);
};
/**
 * Shortcut mechanism for pulling the object's string-based key value using
 * the sStrKeyProperty property name as defined in config.
 */
p.getStrKey = function(){
    return this.get(this.getSettings().sStrKeyProperty);
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
        this.set(this.getSettings().sUpdateTimeProperty,new Date().getTime());
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
                    if (Value instanceof Base && (!Value.getNumKey() || Value.hDelta)) {
                        App.debug('Calling save on '+Value.sClass+' ('+oSelf.sClass+'.'+sProperty+')');
                        Value.save({nTTL:nTTL}, callback);
                    } else
                        callback(null,Value);
                }
                ,function(callback) {
                    var sKey = oSelf.nClass + ':' + oSelf.getNumKey() + ':' + sProperty;
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
                                    if (Value instanceof Base) {
                                        async.parallel([
                                            function(cb){
                                                if (!App.Redis.hOpts.bSkip)
                                                    App.Redis.addToSet({
                                                    sKey:sKey,
                                                    nTTL:nTTL,
                                                    sOrderBy:hSettings.sOrderBy
                                                }, Value, cb);
                                                else
                                                    cb();
                                            }
                                            ,function(cb){
                                                if (!App.MySql.hOpts.bSkip)
                                                    App.MySql.addToSet({
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
            ],function(err){
                oSelf.publish({sClass:'Status',sChanged:sProperty, Value:Value});
                if (fnCallback)
                    fnCallback(err,oSelf);
            });
        }
    } else if (fnCallback)
        fnCallback(null,oSelf);
};

p.deleteExtra = function(sProperty,Value,fnCallback) {
    var oSelf = this;
    if (sProperty && Value && Value instanceof Base) {
        async.series([
            function(callback){
                App.debug('deleteExtra: DELETE '+Value.sClass+' ('+Value.getNumKey()+')');
                Value.delete(callback);
            }
            ,function(callback) {
                if (oSelf[sProperty]) {
                    // Locate the hExtras settings for this class.
                    var hSettings = oSelf.getSettings().hExtras[sProperty];
                    var sKey = oSelf.nClass + ':' + oSelf.getNumKey() + ':' + sProperty;
                    switch (hSettings.sType) {
                        case 'Collection':
                            // Don't save it again if it doesn't need saving.
                            async.parallel([
                                function(cb) {
                                    // Iterate through the collection and remove the item.
                                    if (oSelf[sProperty].nTotal) {
                                        var n = 0;
                                        while (oSelf[sProperty].next()) {
                                            if (oSelf[sProperty].getItem().getNumKey() == Value.getNumKey()) {
                                                App.debug('deleteExtra: SPLICE ITEM '+n);
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
                                    App.Redis.removeFromSet({
                                        sKey:sKey,
                                        sOrderBy:hSettings.sOrderBy
                                    }, Value, cb);
                                }
                                ,function(cb){
                                    App.MySql.addToSet({
                                        sKey:sKey,
                                        sOrderBy:hSettings.sOrderBy
                                    }, Value, cb);
                                }
                            ],callback);
                            break;
                        case 'Increment':
                            App.Redis.del({oObj:oSelf,sProperty:sProperty, nTTL:nTTL}, Value, function (err) {
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

    if (oSelf.getSettings().sStrKeyProperty && !oSelf.get(oSelf.getSettings().sStrKeyProperty))
        oSelf.set(oSelf.getSettings().sStrKeyProperty,String.getSID(oSelf.getSettings().hProperties[oSelf.getSettings().sStrKeyProperty].nLength));

    oSelf.setID(function() {
        if (oSelf.hDelta || oSelf.bNew || (hOpts && hOpts.bForce)) {
            async.parallel([
                function(callback) {
                    if (!App.Redis.hOpts.bSkip) {
                        App.Redis.saveObject(hOpts,oSelf,callback);
                    }else
                        callback();
                }
                ,function(callback) {
                    if (!App.MySql.hOpts.bSkip) {
                        App.MySql.saveObject(hOpts,oSelf,callback);
                    } else
                        callback();
                }
            ],function(err){
                if (err)
                    fnCallback(err);
                else {
                    if (hOpts && hOpts.bForce)
                        oSelf.bForce = hOpts.bForce;
                    oSelf.publish();

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
    // We always track when the item was created and last updated.
    oSelf.setCreateTime();
    oSelf.setUpdateTime();

    if (!oSelf.getNumKey()) {
        oSelf.bNew = true;
        App.Redis.getNextID(oSelf,fnCallback);
    } else
        fnCallback(null,oSelf.getNumKey());
};
/**
 * This returns the environment-specific settings for the class. This will use the 'global' environment
 * settings in the .conf file, overridden by what's configured in the class itself, overridden by any
 * environment specific settings if any.
 *
 * @return {*}
 */
p.getSettings = function() {
    return App.hClasses[this.sClass] || {};

};
/**
 * This method should only be used by internal code for cleaning up records created for testing purposes.
 * @param fnCallback
 */
p.delete = function(fnCallback) {
    var oSelf = this;
    if (oSelf.getNumKey()) {
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
    if (oSelf.getNumKey()) {
        oSelf.getSettings().aProperties.forEach(function(sProp){
            switch (oSelf.getSettings().hProperties[sProp].sType) {
                case 'Boolean':
                    hResult[sProp] = (oSelf.hData[sProp]) ? true : false;
                    break;
                case 'String':
                    if (!oSelf.getSettings().hProperties[sProp].bPrivate)
                        hResult[sProp] = oSelf.hData[sProp] || '';
                    break;
                case 'Number':case 'Timestamp':
                    hResult[sProp] = oSelf.toNumber(oSelf.hData[sProp]) || null;
                    break;
                case 'Float':
                    hResult[sProp] = oSelf.toFloat(oSelf.hData[sProp]) || null;
                    break;
                default:
                    hResult[sProp] = oSelf.hData[sProp];
                    break;
            }
        });
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

p.publish = function() {
    var oSelf = this;

    // If the class has an adapter configured, then we'll call its handle method.
    if (App.hClasses[oSelf.sClass].sAdapterPath && (oSelf.bNew || oSelf.hDelta || oSelf.bRemoved)) {
        // Once the handler is loaded, we don't need to do it again. So see if it is loaded in the cache.
        var sAdapterPath = (App.NORDIS_ENV_ROOT_DIR) ? App.NORDIS_ENV_ROOT_DIR+App.hClasses[oSelf.sClass].sAdapterPath   : App.hClasses[oSelf.sClass].sAdapterPath;
        var Handler = require.cache[sAdapterPath];
        if (!Handler) {
            // Check for overrides and adapters.
            try {
                var Handler = require(sAdapterPath);
            } catch (err) {
                throw new Error('Error when attempting to require adapter for class '+sClass+' at path '+sAdapterPath);
            } finally {
                if (Handler && !Handler.handle)
                    throw new Error('Adapter for '+sClass+' does not have a handle method: module.exports.handle = function(bNew,hDelta,bRemoved,oObj){}; ');
            }
        }

        if (Handler && Handler.handle)
            Handler.handle(oSelf.bNew,oSelf.hDelta,oSelf.bRemoved,oSelf);
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

module.exports = Base;

/**
 * This method will either lookup or return an object of the passed-in sClass (or nClass) type.
 * If the class has a custom path, its module will be properly required.
 * @param hOpts
 * @param fnCallback
 */
module.exports.lookup = function(hOpts,fnCallback) {
    if (hOpts.nClass && !hOpts.sClass)
        hOpts.sClass = App.hClassMap[hOpts.nClass];

    if (App.hClasses[hOpts.sClass] && App.hClasses[hOpts.sClass].sClassPath) {
        var sClassPath = (App.NORDIS_ENV_ROOT_DIR) ? App.NORDIS_ENV_ROOT_DIR+App.hClasses[hOpts.sClass].sClassPath  : App.hClasses[hOpts.sClass].sClassPath;
        var oClass = require(sClassPath);
        return new oClass(hOpts,fnCallback);
    } else
        return new Base(hOpts,fnCallback);
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