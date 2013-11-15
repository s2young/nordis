var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    App         = require('./../lib/AppConfig');

/**
 * This test validates that Nordis will properly create tables if missing from the MySql schema.
 *
 */
var hQuery; // Will be used a couple of times.

module.exports = {
    setUp:function(callback) {
        // We are going to dynamically define a class so that we don't interfere with any other tests.
        // This will allow us to both create and drop the table during the test.
        // The assigned nClass will be a timestamp, to guarantee uniqueness.
        var nClass = new Date().getTime();
        App.hClasses.TempClass = {
            aProperties:['sTitle']
            ,nClass:nClass
            ,sNumericKey:'sID'
        };
        App.hClassMap[nClass] = 'TempClass';
        // We'll use this query a couple of times. Doesn't matter that it won't find any records.
        var hQuery = {};
        hQuery[App.hClasses.TempClass.sNumericKey] = 1;

        callback();
    }
    ,tearDown:function(callback) {
        App.MySql.execute(null,'DROP TABLE IF EXISTS `'+App.MySql.hSettings.sSchema+'`.`TempClassTbl`;',null,callback);
    }
    ,createTable:function(test){
        test.expect(1);
        async.waterfall([
            // This step should result in the creation of the TempClassTbl.
            function(cb) {
                Base.lookup({sClass:'TempClass',hQuery:hQuery},cb);
            }
            ,function(oResult,cb){
                test.equal(oResult.get(App.hClasses.TempClass.sNumericKey),undefined);
                cb();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,addColumn:function(test){
        // Models change over time and properties get added. This simulates the addition of a property to the class
        // definition and then a query on that property.  The new column gets added.
        test.expect(2);
        async.waterfall([
            // This step should result in the creation of the TempClassTbl.
            function(cb) {
                Base.lookup({sClass:'TempClass',hQuery:hQuery},cb);
            }
            ,function(oResult,cb){
                test.equal(oResult.get(App.hClasses.TempClass.sNumericKey),undefined);
                // Let's add a property to the TempClass.aProperties and then query against it.
                App.hClasses.TempClass.aProperties.push('sEmail');
                Base.lookup({sClass:'TempClass',hQuery:{sEmail:'demo@test.com'}},cb);
            }
            ,function(oObj,cb){
                test.equal(oObj.get(App.hClasses.TempClass.sNumericKey),undefined);
                cb();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
};