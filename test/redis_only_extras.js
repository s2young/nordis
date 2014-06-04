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
            ,trackPoints:function(done){

                var nStart = new Date().getTime();
                var setStuff = function(n,cb) {
                    user.setExtra('points',1,function(err){
                        cb(err);
                    });
                };
                var q = async.queue(setStuff,1);
                q.drain = function(){
                    var nTotalTime = (new Date().getTime() - nStart);
                    user.loadExtras({points:true},function(err){
                        user.points.should.equal(nTestSize);
                        Config.log('Total time (Redis): '+nTotalTime+': '+(nTotalTime/nTestSize)+' ms per increment;');
                        done(err);
                    });
                };

                for (var n = 0; n < nTestSize; n++) {
                    q.push(n);
                }
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