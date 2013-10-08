var util    = require('util'),
    fs      = require('fs'),
    events  = require('events'),
    sanitize= require('validator').sanitize,
    check   = require('validator').check,
    App     = require('./AppConfig'),
    String  = require('./Utils/String'),
    REST    = require('./Utils/Data/REST'),
    async   = require('async');

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
                oSelf.sSource = (hOpts && hOpts.sSource) ? hOpts.sSource : App.sDefaultDb;
                App[oSelf.sSource].load(hOpts,oSelf,fnCallback);
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
 * @param hOpts
 * @param fnCallback
 */
p.loadExtras = function(hOpts,fnCallback) {
    var oSelf = this;
    if (hOpts) {
        oSelf.sSource = (hOpts && hOpts.sSource) ? hOpts.sSource : App.sDefaultDb;
        if (hOpts)
            delete hOpts.sSource;
        App[oSelf.sSource].loadExtras({hExtras:hOpts},oSelf,fnCallback);
    } else
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
            try {
                check(value).isInt();
                this.hData[sProperty] = sanitize(value).toInt();
            } catch (err) {
                try {
                    check(value).isFloat();
                    this.hData[sProperty] = sanitize(value).toFloat();
                } catch (err2) {
                    this.hData[sProperty] = null;
                }
            }
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
    if (!sProperty || Value==undefined || Value==null) {
        if (fnCallback)
            fnCallback(null,oSelf);
    } else {
        oSelf.setID(function (err) {
            var done = function (err,Val) {
                oSelf.publish({sClass:'Status',sChanged:sProperty, Value:Val});
                if (fnCallback)
                    fnCallback(err, oSelf);
            };

            if (err)
                done(err);
            else {
                // Locate the hExtras settings for this class.
                var hSettings = oSelf.hSettings().hExtras[sProperty];
                if (!hSettings)
                    done('No settings for '+oSelf.sClass+'.'+sProperty);
                else {
                    var sKey = oSelf.nClass + ':' + oSelf.get('nID') + ':' + sProperty;
                    var nTTL = oSelf.hSettings().nTTL;

                    switch (hSettings.sType) {
                        case 'Collection':
                            // If the collection doesn't yet exist, instantiate it.
                            if (!oSelf[sProperty]) {
                                var Collection = require('./Collection');
                                oSelf[sProperty] = new Collection({sClass:hSettings.sClass});
                            }
                            // Don't save it again if it doesn't need saving.
                            async.waterfall([
                                function(callback) {
                                    if (Value instanceof Base && (!Value.get('nID') || Value.hDelta))
                                        Value.save({nTTL:nTTL}, callback);
                                    else
                                        callback(null,Value);
                                },
                                function(oVal,callback){
                                    oSelf[sProperty].update(oVal);

                                    if (oVal instanceof Base) {
                                        oSelf.sDestination = (oVal.sDestination) ? oVal.sDestination : (oVal.sSource) ? oVal.sSource : (oSelf.sDestintation) ? oSelf.sDestination : (oSelf.sSource) ? oSelf.sSource : App.sDefaultDb;
                                        App[oSelf.sDestination].addToSet({
                                            sKey:sKey,
                                            nTTL:nTTL,
                                            sSortBy:hSettings.sSortBy
                                        }, oVal, callback);
                                    } else
                                        callback();
                                }
                            ],done);

                            break;
                        case 'Increment':
                            App.Redis.increment({sKey:sKey, nTTL:nTTL}, Value, function (err, res) {
                                if (res)
                                    oSelf[sProperty] = Number(res);
                                done(err,oSelf[sProperty]);
                            });
                            break;
                        case 'String':
                            oSelf[sProperty] = Value;
                            App.Redis.set({sKey:sKey, nTTL:nTTL}, Value, done);
                            break;
                        case 'Integer':
                            oSelf[sProperty] = Number(Value);
                            App.Redis.set({sKey:sKey, nTTL:nTTL}, Value, done);
                            break;

                        case 'Stats':
                        case 'Object':
                            async.waterfall([
                                function(callback) {
                                    if (Value instanceof Base) {
                                        if (!Value.get('nID') || Value.hDelta)
                                            Value.save({nTTL:nTTL}, callback);
                                        else
                                            callback(null,Value);
                                    } else  {
                                        var sClass = (hSettings.sClass) ? hSettings.sClass : (oSelf.get('nObjectClass')) ? App.hClassMap[oSelf.get('nObjectClass')] : null;
                                        if (!sClass) {
                                            console.log('MISSING sClass ON:');
                                            console.log(oObj);
                                            console.log(sProperty);
                                        }

                                        var oVal = Base.lookup({sClass:sClass});
                                        if (Value.nID || (Value.hData && Value.hData.nID))
                                            oVal.setData(Value,(Value.nID || Value.hData.nID));
                                        callback(null,oVal);
                                    }
                                },
                                function(oVal,callback){
                                    oSelf[sProperty] = oVal;
                                    oSelf.sDestination = (oSelf.sDestination) ? oSelf.sDestination : App.sDefaultDb;
                                    App[oSelf.sDestination].set({
                                        sKey:sKey,
                                        nTTL:nTTL,
                                        nClass:oSelf[sProperty].nClass
                                    },oSelf[sProperty].get('nID'),callback);
                                }
                            ],done);

                            break;
                    }
                }
            }
        });
    }
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
        oSelf.publish({sClass:'Status',sRemoved:sProperty,Value:Value});
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
            App[oSelf.sDestination].saveObject(hOpts,oSelf,function(err){
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
 * @param hOpts
 * @param fnCallback
 */
p.delete = function(fnCallback) {
    var oSelf = this;
    if (oSelf.get('nID')) {
        oSelf.sSource = (oSelf.sSource) ? oSelf.sSource : App.sDefaultDb;
        App[oSelf.sSource].deleteObject(oSelf,function(err){
            oSelf.bRemoved = true;
            oSelf.publish();
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
        if (!App.hClasses[hOpts.sClass].oLoaded)
            App.hClasses[hOpts.sClass].oLoaded = require(App.sRootClassPath+App.hClasses[hOpts.sClass].sPath);

        return new App.hClasses[hOpts.sClass].oLoaded(hOpts,fnCallback);
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