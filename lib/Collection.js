var util        = require('util'),
    async       = require('async'),
    promise     = require('promise'),
    Base        = require('./Base'),
    Config      = require('./AppConfig');

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

    if (hOpts && hOpts.sClass && Config.getClasses(hOpts.sClass) && Config.getClasses(hOpts.sClass).nClass) {
        oSelf.sClass = hOpts.sClass;
        oSelf.nClass = Config.getClasses(hOpts.sClass).nClass;
    } else if (hOpts && hOpts.nClass && Config.getClassMap(hOpts.nClass)) {
        oSelf.nClass =  hOpts.nClass;
        oSelf.sClass = Config.getClassMap(hOpts.nClass);
    }

    oSelf.nTotal = 0;
    oSelf._nIndex = -1;

    if (!oSelf.sClass && !oSelf.nClass) {
        if (hOpts.sClass=='Metric')
            oSelf.sClass = hOpts.sClass;
        else {
            var sErr = 'The sClass option must be provided to create a Collection!'
            sErr += (hOpts.sClass) ? ' Maybe invalid class: ' + hOpts.sClass : '';
            if (fnCallback)
                fnCallback(sErr);
            else
                throw new Error(sErr);
        }
    }

    if (hOpts) {
        if (hOpts.aObjects) {
            oSelf.nTotal = hOpts.aObjects.length;
            oSelf.nCount = hOpts.aObjects.length;
        } else if (hOpts.hQuery) {

            var nSize = (hOpts.hExtras && hOpts.hExtras.nSize) ? parseFloat(hOpts.hExtras.nSize) : (hOpts.nSize) ? parseFloat(hOpts.nSize) : 0;
            var nFirstID = (hOpts.hExtras && hOpts.hExtras.nFirstID) ? parseFloat(hOpts.hExtras.nFirstID) : (hOpts.nFirstID) ? parseFloat(hOpts.nFirstID) : null;
            var sFirstID = (hOpts.hExtras && hOpts.hExtras.sFirstID) ? hOpts.hExtras.sFirstID : (hOpts.sFirstID) ? hOpts.sFirstID : null;
            var nMax = (hOpts.hExtras && hOpts.hExtras.nMax) ? parseFloat(hOpts.hExtras.nMax) : (hOpts.nMax) ? parseFloat(hOpts.nMax) : null;
            var nMin = (hOpts.hExtras && hOpts.hExtras.nMin) ? parseFloat(hOpts.hExtras.nMin) : (hOpts.nMin) ? parseFloat(hOpts.nMin) : null;
            var bReverse = (hOpts.hExtras && hOpts.hExtras.bReverse) ? hOpts.hExtras.bReverse : (hOpts.bReverse) ? hOpts.bReverse : false;
            var sOrderBy = (hOpts.hExtras && hOpts.hExtras.sOrderBy) ? hOpts.hExtras.sOrderBy : (hOpts.sOrderBy) ? hOpts.sOrderBy : '';
            var sView = (hOpts.hExtras && hOpts.hExtras.sView) ? hOpts.hExtras.sView : (hOpts.sView) ? hOpts.sView : '';

            Config.MySql.loadCollection({
                hQuery:hOpts.hQuery
                ,bReverse:bReverse
                ,sOrderBy:sOrderBy
                ,nSize:nSize
                ,sFirstID:sFirstID||nFirstID
                ,nMax:nMax
                ,nMin:nMin
                ,sView:sView
            },oSelf,function(err,oResult){
                if (err) {
                    fnCallback(err);
                } else if (oSelf.nTotal && hOpts.hExtras) {

                    var n = 0;
                    oSelf.forEach(function(oItem,cb){
                        oItem.loadExtras(hOpts.hExtras,cb);
                        n++;
                    },function(err){
                        fnCallback(err,oSelf);
                    });

                } else {
                    if (fnCallback) fnCallback(null,oSelf);
                }
            },null,true);
        }
    }
};
util.inherits(Collection,Base);
var p = Collection.prototype;

p.loadExtras = function(hOpts,fnCallback) {
    var oSelf = this;
    var n = 0;
    if (oSelf.nTotal)
        oSelf.forEach(function(oItem,cb){
            oItem.loadExtras(hOpts,cb);
        },function(err){
            if (fnCallback) fnCallback(err,oSelf);
        });
    else if (fnCallback)
        fnCallback(null,oSelf);
};

p.delete = function(fnCallback,bFast) {
    var oSelf = this;
    if (oSelf.aObjects && oSelf.aObjects.length > 0) {
        // If a callback is passed, then we'll not callback until all deletes are complete.
        async.forEachOfLimit(oSelf.aObjects,200,function(oObj,n,cb){
	        async.setImmediate(function(){
		        oObj = (oObj instanceof Base) ? oObj : Base.lookup({sClass:oSelf.sClass,hData:oObj});
                oObj.delete(cb,bFast);
	        });
        },function(err){
            if (fnCallback)
                async.setImmediate(function(){
                    fnCallback(err,oSelf);
                });
        });
    } else if (fnCallback) {
        fnCallback(null,oSelf);
    }
};

p.massDelete = function(fnCallback) {
    var oSelf = this;
    if (oSelf.aObjects && oSelf.aObjects.length > 0)

        async.series([
            // Delete in MySql quick and efficient.
            function(callback) {
                Config.MySql.deleteCollection(oSelf,callback);
            }
            // Process delete individually to update cache and child items.
            ,function(callback) {
                oSelf.delete(callback,1);
            }
        ],fnCallback);

    else if (fnCallback)
        fnCallback();
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

p.forEach = function(fnHandler,fnCallback) {
    var oSelf = this;

    if (oSelf.aObjects && oSelf.aObjects.length)
        async.forEachOf(oSelf.aObjects,function(o,n,cb){

            async.setImmediate(function(){
                var oItem = oSelf.getItem(n);
                fnHandler(oItem,cb,n);
            });

        },fnCallback);
    else if (fnCallback)
        fnCallback();

};

p.next = function() {
    this._nIndex++;
    return this.getItem();
};

p.last = function() {
    return this.getItem(this.aObjects.length - 1);
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
        if (oSelf.aObjects[nIndex] instanceof Base) {
            oSelf.aObjects[nIndex]._Tenant = oSelf._Tenant;
            return oSelf.aObjects[nIndex];
        } else {
            // Remove any query that might still be on here so instantiating doesn't trigger a lookup.
            delete oSelf.aObjects[nIndex].hQuery;

            oSelf.aObjects[nIndex] = Base.lookup({
                sClass:oSelf.sClass,
                hData:oSelf.aObjects[nIndex]
            });
            oSelf.aObjects[nIndex]._Tenant = oSelf._Tenant;

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
        sPath:sPath||null,
        nTotal:oSelf.nTotal||0,
        nCount:oSelf.nCount||0,
        nSize:oSelf.nSize||nSize||0,
        sClass:oSelf.sClass,
        nNextID:oSelf.nNextID||null,
        aObjects:[]
    };
    if (oSelf.nTotal)
        oSelf.aObjects.forEach(function(hItem,i){
            var hItem  = oSelf.getItem(i).toHash(hExtras);
            cItems.aObjects.push(hItem);
        });
    return cItems;
};

p.update = function(oObj) {
    var oSelf = this;

    var done = function(bFound) {
        if (!bFound)
            oSelf.add(oObj);
        oSelf.nCount = oSelf.aObjects.length;
    };

    (function loop(){
        if (oSelf.next()) {
            var oItem = oSelf.getItem();

            var nCompareID = (oObj instanceof Base) ? oObj.getKey() : (oObj.hData) ? oObj.hData[Config.hClasses[oSelf.sClass].sKeyProperty] : oObj[Config.hClasses[oSelf.sClass].sKeyProperty];
            if (oItem.getKey() == parseInt(nCompareID)) {
                oSelf.aObjects.splice(oSelf._nIndex,1,oObj);
                done(true);
            }
        } else
            done(false);
    })();
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
        hOpts.sSource = 'MySql';
        Collection.lookup(hOpts,fnCallback);
    } else
        fnCallback('Must provide at least the sClass property in options.');

};