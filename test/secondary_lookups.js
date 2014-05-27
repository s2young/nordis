var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    AppConfig         = require('./../lib/AppConfig');

var user;

module.exports = {
    base:{
        secondary_lookup:{
            beforeEach:function(done) {
                user = Base.lookup({sClass:'User'});
                user.set('name','TestUser');
                user.set('email','test@test.com');
                user.save(done);
            }
            ,afterEach:function(done) {
                user.delete(done);
            }
            // This test should use the _CrossReferenceTbl to find the primary key id of the user with the email test@test.com.
            ,lookupViaSecondaryField:function(done){
                Base.lookupP({sClass:'User',hQuery:{email:'test@test.com'}})
                    .then(function(result){
                        result.getKey().should.equal(user.getKey());
                    })
                    .then(null,function(err){throw err})
                    .done(done);
            }
            // This test simulates a missing cross-reference value and looks the record up directly against the table using the email.
            ,lookupWhenCrossRefMissing:function(done){

                async.waterfall([
                    function(cb) {
                        // First, let's remove the _CrossReferenceTbl record for this lookup in redis.
                        AppConfig.Redis.acquire(function(err,oClient){
                            if (err)
                                cb(err);
                            else
                                oClient.del(user.getClass()+':'+user.get('email'),cb);
                        });
                    }
                    ,function(res,cb) {
                        // Next, in MySql.
                        AppConfig.MySql.execute('DELETE FROM _CrossReferenceTbl WHERE sID=?',[user.getClass()+':'+user.get('email')],cb);
                    }
                    ,function(res,cb) {
                        Base.lookup({sClass:'User',hQuery:{email:'test@test.com'}},cb);
                    }
                    ,function(result,cb){
                        result.getKey().should.equal(user.getKey());
                        cb();
                    }
                ],done);
            }
            ,lookupEmailNotPresent:function(done){
                async.waterfall([
                    function(cb){
                        Base.lookup({sClass:'User',hQuery:{email:'testy@test.com'}},cb);
                    }
                    ,function(result,cb) {
                        (result.getKey()===null).should.be.ok;
                        cb();
                    }
                ],done);
            }
        }
    }
};