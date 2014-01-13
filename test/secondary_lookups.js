var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    App         = require('./../lib/AppConfig');

module.exports = {
    setUp:function(callback) {
        var self = this;
        self.user = Base.lookup({sClass:'User'});
        self.user.set('name','TestUser');
        self.user.set('email','test@test.com');
        self.user.save(null,callback);
    }
    ,tearDown:function(callback) {
        var self = this;
        self.user.delete(callback);
    }
    ,lookupViaSecondaryField:function(test){
        var self = this;
        test.expect(1);
        // This test should use the _CrossReferenceTbl to find the primary key id of the user with the email test@test.com.
        async.waterfall([
            function(cb) {
                Base.lookup({sClass:'User',hQuery:{email:'test@test.com'}},cb);
            }
            ,function(user,cb){
                test.equal(self.user.getNumKey(),user.getNumKey());
                cb();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,lookupWhenCrossRefMissing:function(test){
        var self = this;
        test.expect(1);
        // This test simulates a missing cross-reference value and looks the record up directly against the table using the email.
        async.waterfall([
            function(cb) {
                // First, let's remove the _CrossReferenceTbl record for this lookup in redis.
                App.Redis.acquire(function(err,oClient){
                    if (err)
                        cb(err);
                    else
                        oClient.del(self.user.nClass+':'+self.user.get('email'),cb);
                });
            }
            ,function(res,cb) {
                // Next, in MySql.
                App.MySql.execute(null,'DELETE FROM _CrossReferenceTbl WHERE sID=?',[self.user.nClass+':'+self.user.get('email')],cb);
            }
            ,function(res,cb) {
                Base.lookup({sClass:'User',hQuery:{email:'test@test.com'}},cb);
            }
            ,function(user,cb){
                test.equal(self.user.getNumKey(),user.getNumKey());
                cb();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,lookupEmailNotPresent:function(test){
        async.waterfall([
            function(cb){
                Base.lookup({sClass:'User',hQuery:{email:'testy@test.com'}},cb);
            }
            ,function(user,cb) {
                test.equal(user.getNumKey(),undefined);
                cb();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
};