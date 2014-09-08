var express     = require('express'),
    request     = require('request'),
    async       = require('async'),
    should      = require('should'),
    Base        = require('./../../lib/Base'),
    Collection  = require('./../../lib/Collection'),
    Middleware  = require('./../../lib/Utils/Middleware'),
    Config      = require('./../../lib/AppConfig');

var nTestSize = 10;
var nPort = 2002; // Port on which to run api instance during test.
var server;
var user;

module.exports = {
    api:{
        before:function(done) {

            async.series([
                function(cb) {
                    Config.init({bBuildMySql:true},cb);
                }
                // Create a user we'll look up via an api call.
                ,function(cb){
                    user = Base.lookup({sClass:'User'});
                    user.set('name','TestUser');
                    user.set('email','test@test.com');
                    user.save(cb);
                }
                ,function(cb) {
                    // Create n follower records  (n = nTestSize);
                    var createFollower = function(n,callback) {
                        var follower_user = Base.lookup({sClass:'User'});
                        follower_user.set('name','TestFollower '+n);
                        follower_user.set('email','testfollower'+n+'@test.com');
                        follower_user.save(function(err){
                            if (err)
                                callback(err);
                            else {
                                var follow = Base.lookup({sClass:'Follow'});
                                follow.set('followed_id',user.getKey());
                                follow.set('follower_id',follower_user.getKey());
                                follow.set('rank',n);
                                follow.save(function(err){
                                    callback(err);
                                });
                            }
                        });
                    };
                    var q = async.queue(createFollower,100);
                    q.drain = cb;

                    for (var n = 0; n < nTestSize; n++) {
                        q.push(n);
                    }
                }
                // Next, fire up a temporary api running on port 2002. This is all that's needed for a simple api with no permission implications.
                ,function(cb) {
                    var exp_app = express();
                    server = exp_app.listen(nPort);
                    exp_app.use(require('body-parser')());
                    exp_app.use(Middleware.apiParser);
                    cb();
                }
            ],done);
        }
        ,after:function(done) {

            async.waterfall([
                function(cb) {
                    Collection.lookupAll({sClass:'User'},cb);
                }
                ,function(users,cb) {
                    users.delete(cb);
                }
                ,function(ignore,cb){
                    Collection.lookupAll({sClass:'Follow'},cb);
                }
                ,function(follows,cb) {
                    follows.delete(cb);
                }
                ,function(ignore,cb){
                    if (server)
                        server.close();
                    cb(null,null);
                }
            ],done);
        }
        ,lookupUser:function(done) {

            Base.requestP('get','http://localhost:'+nPort+'/user/'+user.getKey())
                .then(function(hResult){
                    hResult.id.should.equal(user.getKey());
                })
                .then(null,function(err){throw err})
                .done(done);

        }
    }
};