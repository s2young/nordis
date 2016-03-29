var async       = require('async'),
    should      = require('should'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    Config      = require('./../lib/AppConfig');

var nTestSize = 10;
var user;

module.exports = {
    base:{
        redis_extras:{
            beforeEach:function(done) {
                user = Base.lookup({sClass:'User'});
                user.set('name','TestUser');
                user.set('email','test@test.com');
                user.save(done);
            }
            ,afterEach:function(done) {
                user.delete(done);
            }
            ,lookupUserAndExtras:function(done){

                var nStart = new Date().getTime();
                // Lookup user by primary key (nID) and request some extras.
                var hQuery = {};
                hQuery[Config.getClasses('User').sKeyProperty] = user.getKey();
                Base.lookup({
                    sClass:'User'
                    ,hQuery:hQuery
                    ,hExtras:{points:true}
                },function(err,result){
                    Config.log('Lookup time for primary key lookup of user + three static extras + one object extra: '+(new Date().getTime()-nStart)+' ms');
                    result.getKey().should.equal(user.getKey());
                    done();
                });
            }
        }
    }
};