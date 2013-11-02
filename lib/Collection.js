var util    = require('util'),
    async   = require('async'),
    App     = require('./AppConfig'),
    Base    = require('./Base');

/**
 * @param hOpts - This has should include at least 'sClass' which is the name of the class.
 * If you're retrieving data, then you need an 'hQuery' object in hOpts with specifications on what to retrieve.
 * If you want paging or sorting, include properties like nIndex, nSize and sOrderBy.
 * @param fnCallback
 */
function Collection(hOpts,fnCallback) {
    var oSelf = this;

    oSelf.aObjects = (hOpts && hOpts.aObjects) ? hOpts.aObjects : [];
    oSelf.nIndex = (hOpts && isNaN(hOpts.nIndex)) ? 0 : hOpts.nIndex;
    oSelf.nSize = (hOpts && isNaN(hOpts.nSize)) ? 0 : hOpts.nSize;
    oSelf.sClass = (hOpts && hOpts.sClass) ? hOpts.sClass : '';
    oSelf.nClass = (hOpts && hOpts.nClass) ? hOpts.nClass : undefined;

    oSelf.nTotal = 0;
    oSelf._nIndex = -1;

    if (oSelf.sClass && App.hClasses[oSelf.sClass])
        oSelf.nClass = App.hClasses[oSelf.sClass].nClass;
    else if (oSelf.nClass && App.hClassMap[oSelf.nClass])
        oSelf.sClass = App.hClassMap[oSelf.nClass].sClass;
    else {
        console.log(new Error().stack);
        throw('The sClass option must be provided to create a Collection object!');
    }

    if (hOpts.aObjects) {
        oSelf.nTotal = hOpts.aObjects.length;
        oSelf.nCount = hOpts.aObjects.length;
    }
    if (hOpts && hOpts.hQuery) {
        oSelf.sSource = (hOpts && hOpts.sSource) ? hOpts.sSource : App.sDefaultDb;
        App[oSelf.sSource].loadCollection(hOpts,oSelf,fnCallback);
    }
}
util.inherits(Collection,Base);
var p = Collection.prototype;

p.loadExtras = function(hOpts,fnCallback){
    var oSelf = this;
    if (hOpts) {
        oSelf.sSource = (hOpts && hOpts.sSource) ? hOpts.sSource : App.sDefaultDb;
        (function loop(){
            if (oSelf.next())
                oSelf.getCurrent().loadExtras(hOpts,loop);
            else
                fnCallback(null,oSelf);
        })();
    } else
        fnCallback(null,oSelf);
};

p.delete = function(fnCallback) {
    var oSelf = this;

    var deleteItem = function(oItem,callback){
        oItem.delete(callback);
    };
    var q = async.queue(deleteItem,10);
    q.drain = fnCallback;

    if (oSelf.nTotal) {
        oSelf.reset();
        while (oSelf.next()) {
            q.push(oSelf.getCurrent());
        }
    } else if (fnCallback) {
        fnCallback();
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
        if (oSelf.sClass == 'RSVP')
            oSelf.nNextID = oSelf.aObjects[oSelf.nSize].nEventID;
        else if (oSelf.sClass == 'Role')
            oSelf.nNextID = oSelf.aObjects[oSelf.nSize].nObjectID;
        else
            oSelf.nNextID = oSelf.aObjects[oSelf.nSize].nID;

        oSelf.aObjects = oSelf.aObjects.splice(0,oSelf.nSize);
        oSelf.nCount = oSelf.aObjects.length;
    }
};

p.first = function() {
    this._nIndex = 0;
    return this.getCurrent();
};

p.next = function() {
    if (this._nIndex == this.nCount) {
        this._nIndex = -1;
        return null;
    } else {
        this._nIndex++;
        return this.getCurrent();
    }

};

p.last = function() {
    this._nIndex = Number(this.nCount - 1);
    return this.getCurrent();
};

p.reset = function(){
    this._nIndex = -1;
};

p.add = function(oObj,bIgnoreTotal) {
    this.aObjects.push(oObj);
    this.nCount = this.aObjects.length ? this.aObjects.length : 0;
    if (!this.nTotal)
        this.nTotal = this.aObjects.length ? this.aObjects.length : 0;
    else if (!bIgnoreTotal)
        this.nTotal++;
};

p.empty = function(){
    this.aObjects = [];
    this.nTotal = 0;
    this.nCount = 0;
    this.nIndex = 0;
    this.reset();
};

p.getCurrent = function() {
    var oSelf = this;
    if (oSelf.aObjects[oSelf._nIndex]) {
        if (oSelf.aObjects[oSelf._nIndex] instanceof Base)
            return oSelf.aObjects[oSelf._nIndex];
        else {
            // Remove any query that might still be on here so instantiating doesn't trigger a lookup.
            delete oSelf.aObjects[oSelf._nIndex].hQuery;

            oSelf.aObjects[oSelf._nIndex] = Base.lookup({
                sClass:oSelf.sClass,
                hData:oSelf.aObjects[oSelf._nIndex]
            });

            if (!oSelf.nClass)
                oSelf.nClass = oSelf.aObjects[oSelf._nIndex].nClass;

            return oSelf.aObjects[oSelf._nIndex];
        }
    } else {
        oSelf.reset();
        return null;
    }
};

p.toHash = function(hExtras) {
    var oSelf = this;
    var cItems = {
        nTotal:oSelf.nTotal||0,
        nCount:oSelf.nCount||0,
        nIndex:oSelf.nIndex||0,
        nSize:oSelf.nSize||0,
        sClass:oSelf.sClass,
        nNextID:oSelf.nNextID||null,
        aObjects:[]
    };
    if (oSelf.nTotal) {
        oSelf.reset();
        while (oSelf.next())
            cItems.aObjects.push(oSelf.getCurrent().toHash(hExtras));
    }

    return cItems;
};

module.exports = Collection;