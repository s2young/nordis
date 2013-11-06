var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    App         = require('./../lib/AppConfig');

/**
 * This test validates that Nordis will properly create tables if missing from the MySql schema.
 *
 */
module.exports = {
    setUp:function(callback) {
        // We are going to dynamically define a class so that we don't interfere with any other tests.
        // This will allow us to both create and drop the table during the test.
        // The assigned nClass will be a timestamp, to guarantee uniqueness.
        var nClass = new Date().getTime();
        App.hClasses.TempClass = {
            aProperties:['sTitle']
            ,nClass:nClass
        };
        App.hClassMap[nClass] = 'TempClass';
        callback();
    }
    ,tearDown:function(callback) {
        App.MySql.execute(null,'DROP TABLE IF EXISTS `'+App.MySql.hSettings.sSchema+'`.`TempClassTbl`;',null,callback);
    }
    ,createTable:function(test){
        test.expect(1);
        // This test should result in the creation of the TempClassTbl.
        async.waterfall([
            function(cb) {
                Base.lookup({sClass:'TempClass',hQuery:{nID:1}},cb);
            }
            ,function(oUser,cb){
                test.equal(oUser.get('nID'),undefined);
                cb();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,addColumn:function(test){
        // Models change over time and properties get added. This simulates the addition of a property to the class
        // definition and then a query on that property.  The new column gets added.
        test.expect(2);
        async.waterfall([
            function(cb) {
                // This test should result in the creation of the TempClassTbl.
                Base.lookup({sClass:'TempClass',hQuery:{nID:1}},cb);
            }
            ,function(oUser,cb){
                test.equal(oUser.get('nID'),undefined);
                // Let's add a property to the TempClass.aProperties and then query against it.
                App.hClasses.TempClass.aProperties.push('sEmail');
                Base.lookup({sClass:'TempClass',hQuery:{sEmail:'demo@test.com'}},cb);
            }
            ,function(oObj,cb){
                test.equal(oObj.get('nID'),undefined);
                cb();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
};