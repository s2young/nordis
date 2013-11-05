var util    = require('util'),
    async   = require('async'),
    App     = require('./AppConfig'),
    Base    = require('./Base');

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
    oSelf.sClass = (hOpts && hOpts.sClass) ? hOpts.sClass : '';
    oSelf.nClass = (hOpts && hOpts.nClass) ? hOpts.nClass : undefined;

    oSelf.nTotal = 0;
    oSelf._nIndex = -1;

    if (oSelf.sClass && App.hClasses[oSelf.sClass])
        oSelf.nClass = App.hClasses[oSelf.sClass].nClass;
    else if (oSelf.nClass && App.hClassMap[oSelf.nClass])
        oSelf.sClass = App.hClassMap[oSelf.nClass].sClass;
    else
        throw new Error('The sClass option must be provided to create a Collection object!');

    if (hOpts.aObjects) {
        oSelf.nTotal = hOpts.aObjects.length;
        oSelf.nCount = hOpts.aObjects.length;
    }
    if (hOpts && hOpts.hQuery) {
        App.MySql.loadCollection(hOpts,oSelf,fnCallback);
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
                if ((oItem instanceof Base)===false)
                    oItem = Base.lookup({sClass:oSelf.sClass,hData:oItem});
                oItem.delete(callback);
            };
            async.forEachLimit(oSelf.aObjects,100,deleteItem,function(err){
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
    oSelf.nNextID = null;

    if (aData && aData.length > 0)
        oSelf.aObjects = aData;

    oSelf.nCount = oSelf.aObjects.length;
    if (!oSelf.nTotal)
        oSelf.nTotal = oSelf.aObjects.length;

    if (oSelf.nSize && oSelf.nCount > oSelf.nSize) {
        oSelf.nNextID = oSelf.aObjects[oSelf.nSize].nID;
        oSelf.aObjects = oSelf.aObjects.splice(0,oSelf.nSize);
        oSelf.nCount = oSelf.aObjects.length;
    }
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
        } else {
            return;
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

p.add = function(oObj,bIgnoreTotal,bReturnObj) {
    var oSelf = this;


    if (bReturnObj) {
        if ((oObj instanceof Base)===false)
            oObj = Base.lookup({sClass:oSelf.sClass,hData:oObj});
        oObj.clean();
    }

    this.aObjects.push(oObj);
    this.nCount = this.aObjects.length ? this.aObjects.length : 0;
    if (!this.nTotal)
        this.nTotal = this.aObjects.length ? this.aObjects.length : 0;
    else if (!bIgnoreTotal)
        this.nTotal++;

    if (bReturnObj)
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

            if (!oSelf.nClass)
                oSelf.nClass = oSelf.aObjects[nIndex].nClass;

            return oSelf.aObjects[nIndex];
        }
    } else {
        oSelf._nIndex = -1;
        return null;
    }
};

p.toHash = function(hExtras) {
    var oSelf = this;
    var cItems = {
        nTotal:oSelf.nTotal||0,
        nCount:oSelf.nCount||0,
        nSize:oSelf.nSize||0,
        sClass:oSelf.sClass,
        nNextID:oSelf.nNextID||null,
        aObjects:[]
    };
    if (oSelf.nTotal) {
        while (oSelf.next())
            cItems.aObjects.push(oSelf.getItem().toHash(hExtras));
    }

    return cItems;
};

module.exports = Collection;