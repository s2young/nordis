var express     = require('express'),
    request     = require('request'),
    async       = require('async'),
    should      = require('should'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    Middleware  = require('./../lib/Utils/Middleware'),
    Config      = require('./../lib/AppConfig');

var nTestSize = 10;
var nPort = 2002; // Port on which to run api instance during test.
var server;
var user;

module.exports = {
    api:{
        before:function(done) {

            async.series([
                // Create a user we'll look up via an api call.
                function(cb){
                    user = Base.lookup({sClass:'User'});
                    user.set('name','TestUser');
                    user.set('email','test@test.com');
                    user.save(cb);
                }
                ,function(cb) {
                    // Create n follower records  (n = nTestSize);
                    var q = [];
                    for (var n = 0; n < nTestSize; n++) {
                        q.push(n);
                    }
                    async.forEachOfLimit(q,100,function(n,ind,callback){

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

                    },cb);
                }
                // Next, fire up a temporary api running on port 2002. This is all that's needed for a simple api with no permission implications.
                ,function(cb) {
                    Config.init(null,function(err){
                        if (err)
                            cb(err);
                        else {
                            var exp_app = express();
                            server = exp_app.listen(nPort);
                            exp_app.use(require('body-parser')());
                            exp_app.use(Middleware.apiParser);
                            cb();
                        }
                    });
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
                    if (server) server.close();
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
        ,lookupUserAndFollowers:function(done) {

            // This time, we'll request the user's follows collection along with the user him
            Base.requestP('get','http://localhost:'+nPort+'/user/'+user.getKey(),{
                    hExtras:{
                        follows:{
                            hExtras:{
                                follower_user:true // We'll get each follower user object on the follows collection.
                            }
                        }
                    }
                })
                .then(function(hResult){
                    hResult.id.should.equal(user.getKey());
                    hResult.follows.nTotal.should.equal(nTestSize);
                })
                .then(null,function(err){throw err})
                .done(done);

        }
        ,changeUserName:function(done) {
            // This test submits a save.json call on the existing user, changing his name.

            var sNewName = 'Dummy';
            Base.requestP('post','http://localhost:'+nPort+'/user/'+user.getKey(),{name:sNewName,email:'test@test.com'})
                .then(function(hResult){
                    hResult.name.should.equal(sNewName);
                })
                .then(null,function(err){throw err})
                .done(done);

        }
        ,badClassInRequest:function(done) {

            Base.requestP('post','http://localhost:'+nPort+'/badclass',null)
                .then(null,function(err){
                    err.should.equal('Malformed request.');
                })
                .done(done);

        }
        ,lookupUserByNumberID:function(done) {

            Base.requestP('get','http://localhost:'+nPort+'/user/'+user.getKey())
                .then(function(hResult){
                    hResult.id.should.equal(user.getKey());
                })
                .then(null,function(err){throw err})
                .done(done);

        }
        ,loadFollowersNatively:function(done) {

            Base.lookupP({sClass:'User',hQuery:{id:user.getKey()},hExtras:{follows:true}})
                .then(function(hResult){
                    hResult.follows.nTotal.should.equal(nTestSize);
                    if (Config.Redis.hOpts.default.bSkip)
                        hResult.follows.sSource.should.equal('MySql');
                    else
                        hResult.follows.sSource.should.equal('Redis');
                })
                .then(null,function(err){throw err})
                .done(done);

        }
    }
};