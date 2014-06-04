var util        = require('util'),
    async       = require('async'),
    promise     = require('promise'),
    Base        = require('./Base'),
    Config      = Base.prototype.Config.inst || Base.prototype.Config;

/**
 * @param hOpts - This has should include at least 'sClass' which is the name of the class.
 * If you're retrieving data, then you need an 'hQuery' object in hOpts with specifications on what to retrieve.
 * If you want paging or sorting, include properties like nSize and sOrderBy.
 * @param fnCallback
 */
function Collection(hOpts,fnCallback) {
    var oSelf = this;

    oSelf.aObjects = (hOpts && hOpts.aObjects) ? hOpts.aObjects : [];
    oSelf.nSize = (hOpts && isNaN(hOpts.nSize)) ? 0 : hOpts.nSize;
    if (hOpts && hOpts.sClass) {
        oSelf.sClass =  hOpts.sClass;
        if (Config.getClasses(oSelf.sClass) && Config.getClasses(oSelf.sClass).nClass)
            oSelf.nClass = Config.getClasses(oSelf.sClass).nClass;
    }
    if (hOpts && hOpts.nClass) {
        oSelf.nClass =  hOpts.nClass;
        if (Config.getClassMap(oSelf.nClass))
            oSelf.sClass = Config.getClassMap(oSelf.nClass);
    }

    oSelf.nTotal = 0;
    oSelf._nIndex = -1;

    if (!oSelf.sClass && !oSelf.nClass)
        throw new Error('The sClass option must be provided to create a Collection object!');

    if (hOpts) {
        if (hOpts.aObjects) {
            oSelf.nTotal = hOpts.aObjects.length;
            oSelf.nCount = hOpts.aObjects.length;
        } else if (hOpts.hQuery && !Config.get('MySql').hOpts.bSkip) {

            var nSize = (hOpts.hExtras && hOpts.hExtras.nSize) ? oSelf.toNumber(hOpts.hExtras.nSize) : (hOpts.nSize) ? oSelf.toNumber(hOpts.nSize) : 0;
            var nFirstID = (hOpts.hExtras && hOpts.hExtras.nFirstID) ? oSelf.toNumber(hOpts.hExtras.nFirstID) : (hOpts.nFirstID) ? oSelf.toNumber(hOpts.nFirstID) : null;
            var sFirstID = (hOpts.hExtras && hOpts.hExtras.sFirstID) ? hOpts.hExtras.sFirstID : (hOpts.sFirstID) ? hOpts.sFirstID : null;
            var nMax = (hOpts.hExtras && hOpts.hExtras.nMax) ? oSelf.toNumber(hOpts.hExtras.nMax) : (hOpts.nMax) ? oSelf.toNumber(hOpts.nMax) : null;
            var nMin = (hOpts.hExtras && hOpts.hExtras.nMin) ? oSelf.toNumber(hOpts.hExtras.nMin) : (hOpts.nMin) ? oSelf.toNumber(hOpts.nMin) : null;
            var bReverse = (hOpts.hExtras && hOpts.hExtras.bReverse) ? hOpts.hExtras.bReverse : (hOpts.bReverse) ? hOpts.bReverse : false;
            var sOrderBy = (hOpts.hExtras && hOpts.hExtras.sOrderBy) ? hOpts.hExtras.sOrderBy : (hOpts.sOrderBy) ? hOpts.sOrderBy : '';

            Config.get('MySql').loadCollection({
                hQuery:hOpts.hQuery
                ,bReverse:bReverse
                ,sOrderBy:sOrderBy
                ,nSize:nSize
                ,sFirstID:sFirstID||nFirstID
                ,nMax:nMax
                ,nMin:nMin
            },oSelf,function(err,oClient){
                if (err) {
                    Config.get('MySql').release(oClient);
                    fnCallback(err);
                } else if (oSelf.nTotal && hOpts.hExtras) {

                    var n = 0;
                    async.forEachLimit(oSelf.aObjects,1,function(hItem,cb){
                        var oItem = oSelf.getItem(n);
                        oItem.loadExtras(hOpts.hExtras,cb,oClient);
                        n++;
                    },function(err){
                        Config.get('MySql').release(oClient);
                        fnCallback(err,oSelf);
                    });

                } else {
                    Config.get('MySql').release(oClient);
                    fnCallback(null,oSelf);
                }
            });
        }
    }
};
util.inherits(Collection,Base);
var p = Collection.prototype;

p.delete = function(fnCallback) {
    var oSelf = this;
    if (oSelf.aObjects.length > 0) {
        // If a callback is passed, then we'll not callback until all deletes are complete.
        if (fnCallback) {
            var deleteItem = function(oItem,callback){
                oItem = Base.cast(oItem,oSelf.sClass);
                oItem.delete(callback);
            };
            async.forEach(oSelf.aObjects,deleteItem,function(err){
                fnCallback(err,oSelf);
            });
        } else {
            // This loop is non-blocking so it will just remove everything when it is gotten to.
            oSelf.forEach(function(oObj,nIndex) {
                oObj.delete();
            });
        }
    } else if (fnCallback) {
        fnCallback(null,oSelf);
    }
};

p.setData = function(aData){
    var oSelf = this;
    delete oSelf.nFirstID;
    delete oSelf.sFirstID;

    if (aData && aData.length > 0)
        oSelf.aObjects = aData;

    oSelf.nCount = oSelf.aObjects.length;
    if (!oSelf.nTotal)
        oSelf.nTotal = oSelf.aObjects.length;
};

p.first = function() {
    return this.getItem(0);
};

p.forEach = function(fnHandler) {
    var oSelf = this;
    var nIndex = -1;
    (function loop(){
        nIndex++;
        if (oSelf.aObjects[nIndex]) {
            fnHandler(oSelf.getItem(nIndex),nIndex);
            setImmediate(loop);
        }
    })();
};

p.next = function() {
    this._nIndex++;
    return this.getItem();
};

p.last = function() {
    return this.getItem(Number(this.aObjects.length - 1));
};

p.add = function(oObj,bIgnoreTotal) {
    var oSelf = this;

    oObj = Base.cast(oObj,oSelf.sClass);
    oObj.clean();

    this.aObjects.push(oObj);
    this.nCount = this.aObjects.length ? this.aObjects.length : 0;
    if (!this.nTotal)
        this.nTotal = this.aObjects.length ? this.aObjects.length : 0;
    else if (!bIgnoreTotal)
        this.nTotal++;

    return oObj;
};

p.empty = function(){
    this.aObjects = [];
    this.nTotal = 0;
    this.nCount = 0;
};

p.getItem = function(nIndex) {
    var oSelf = this;
    if (nIndex == undefined) nIndex = oSelf._nIndex;
    if (oSelf.aObjects[nIndex]) {
        if (oSelf.aObjects[nIndex] instanceof Base)
            return oSelf.aObjects[nIndex];
        else {
            // Remove any query that might still be on here so instantiating doesn't trigger a lookup.
            delete oSelf.aObjects[nIndex].hQuery;

            oSelf.aObjects[nIndex] = Base.lookup({
                sClass:oSelf.sClass,
                hData:oSelf.aObjects[nIndex]
            });

            if (oSelf.nClass==undefined)
                oSelf.nClass = oSelf.aObjects[nIndex].nClass;

            return oSelf.aObjects[nIndex];
        }
    } else {
        oSelf._nIndex = -1;
        return null;
    }
};

p.reset = function(){
    this._nIndex = -1;
};

p.toHash = function(hExtras,sPath,nSize) {
    // Print out the requested extras.
    var oSelf = this;
    var cItems = {
        hExtras:hExtras,
        sPath:sPath||null,
        nTotal:oSelf.nTotal||0,
        nCount:oSelf.nCount||0,
        nSize:oSelf.nSize||nSize||0,
        sClass:oSelf.sClass,
        nNextID:oSelf.nNextID||null,
        aObjects:[]
    };
    if (oSelf.nTotal) {
        while (oSelf.next()) {
            if (oSelf.getItem() && oSelf.getItem() instanceof Base)
                cItems.aObjects.push(oSelf.getItem().toHash(hExtras));
        }
    }

    return cItems;
};

module.exports = Collection;

module.exports.lookup = function(hOpts,fnCallback) {
    return new Collection(hOpts,fnCallback);
};

module.exports.lookupP = function(hOpts) {
    return new promise(function (resolve, reject) {
        Collection.lookup(hOpts,function(err,oObj){
            if (err)
                reject(err);
            else
                resolve(oObj);
        });
    });
};

/**
 * Convenience method for retrieving all objects of a particular type.
 * @param sClass
 * @param fnCallback
 */
module.exports.lookupAll = function(hOpts,fnCallback) {
    if (hOpts && hOpts.sClass) {
        var oInstance = Base.lookup({sClass:hOpts.sClass});
        hOpts.hQuery = {};
        hOpts.hQuery[oInstance.getSettings().sKeyProperty] = 'NOT NULL';
        Collection.lookup(hOpts,fnCallback);
    } else
        fnCallback('Must provide at least the sClass property in options.');

};