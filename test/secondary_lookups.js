var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    App         = require('./../lib/AppConfig');

module.exports = {
    setUp:function(callback) {
        var oSelf = this;
        oSelf.oUser = Base.lookup({sClass:'User'});
        oSelf.oUser.set('sName','TestUser');
        oSelf.oUser.set('sEmail','test@test.com');
        oSelf.oUser.save(null,callback);
    }
    ,tearDown:function(callback) {
        var oSelf = this;
        oSelf.oUser.delete(callback);
    }
    ,lookupViaSecondaryField:function(test){
        var oSelf = this;
        test.expect(1);
        // This test should use the _CrossReferenceTbl to find the primary key id of the user with the email test@test.com.
        async.waterfall([
            function(cb) {
                Base.lookup({sClass:'User',hQuery:{sEmail:'test@test.com'}},cb);
            }
            ,function(oUser,cb){
                test.equal(oSelf.oUser.getNumKey(),oUser.getNumKey());
                cb();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,lookupWhenCrossRefMissing:function(test){
        var oSelf = this;
        test.expect(1);
        // This test simulates a missing cross-reference value and looks the record up directly against the table using the email.
        async.waterfall([
            function(cb) {
                // First, let's remove the _CrossReferenceTbl record for this lookup.
                // First in redis.
                App.Redis.acquire(function(err,oClient){
                    if (err)
                        cb(err);
                    else
                        oClient.del(oSelf.oUser.nClass+':'+oSelf.oUser.get('sEmail'),cb);
                });
            }
            ,function(res,cb) {
                // First, let's remove the _CrossReferenceTbl record for this lookup.
                // First in redis.
                App.MySql.acquire(function(err,oClient){
                    if (err)
                        cb(err);
                    else
                        oClient.query('DELETE FROM _CrossReferenceTbl WHERE sID=?',[oSelf.oUser.nClass+':'+oSelf.oUser.get('sEmail')],function(err){
                            cb(err,null);
                        });
                });
            }
            ,function(res,cb) {
                Base.lookup({sClass:'User',hQuery:{sEmail:'test@test.com'}},cb);
            }
            ,function(oUser,cb){
                test.equal(oSelf.oUser.getNumKey(),oUser.getNumKey());
                cb();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,lookupEmailNotPresent:function(test){
        var oSelf = this;

        async.waterfall([
            function(cb){
                Base.lookup({sClass:'User',hQuery:{sEmail:'testy@test.com'}},cb);
            }
            ,function(oUser,cb) {
                test.equal(oUser.getNumKey(),undefined);
                cb();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
};