var express     = require('express'),
    request     = require('request'),
    async       = require('async'),
    Base        = require('./../../lib/Base'),
    Collection  = require('./../../lib/Collection'),
    Middleware  = require('./../../lib/Utils/Middleware'),
    AppConfig         = require('./../../lib/AppConfig');

var nTestSize = 10;
var nPort = 2002; // Port on which to run api instance during test.
var server;

module.exports = {
    setUp:function(callback) {
        var self = this;
        async.series([
            // Create a user we'll look up via an api call.
            function(cb){
                self.user = Base.lookup({sClass:'User'});
                self.user.set('name','TestUser');
                self.user.set('email','test@test.com');
                self.user.save(cb);
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
                            follow.set('followed_id',self.user.getKey());
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
                AppConfig.init(null,function(err){
                    if (err)
                        cb(err);
                    else {
                        var exp_app = express();
                        server = exp_app.listen(nPort);
                        exp_app.use(express.bodyParser());
                        exp_app.use(Middleware.apiParser);
                        cb();
                    }
                });
            }
        ],callback);
    }
    ,tearDown:function(callback) {
        var self = this;
        async.waterfall([
            function(cb) {
                new Collection({sClass:'User',hQuery:{email:'NOT NULL'}},cb);
            }
            ,function(users,cb) {
                users.delete(cb);
            }
            ,function(ignore,cb){
                var hQuery = {};
                hQuery[AppConfig.hClasses.Follow.sKeyProperty] = 'NOT NULL';
                new Collection({sClass:'Follow',hQuery:hQuery},cb);
            }
            ,function(follows,cb) {
                follows.delete(cb);
            }
            ,function(ignore,cb){
                if (server)
                    server.close();
                cb();
            }
        ],callback);
    }
    ,lookupUser:function(test) {
        var self = this;
        test.expect(1);

        async.waterfall([
            function(callback){
                request.get({uri:'http://localhost:'+nPort+'/user/'+self.user.getStrKey()},function(error, response, body){
                    if (error)
                        callback(error);
                    else {
                        try {
                            callback(error,JSON.parse(body));
                        } catch (err) {
                            AppConfig.error(body);
                        }
                    }

                });
            }
            ,function(hResult,callback){
                var user = Base.lookup({sClass:'User',hData:hResult});
                test.equal(user.getKey(),self.user.getKey());
                callback();
            }
        ],function(err){ AppConfig.wrapTest(err,test); });
    }
    ,lookupUserAndFollowers:function(test) {
        var self = this;
        test.expect(2);

        // This time, we'll request the user's follows collection along with the user himself.
        var hData = {
            hExtras:{
                follows:{
                    hExtras:{
                        follower_user:true // We'll get each follower user object on the follows collection.
                    }
                }
            }
        };

        async.waterfall([
            function(callback){
                request.get({uri:'http://localhost:'+nPort+'/user/'+self.user.getStrKey(),qs:hData},function(error, response, body){
                    callback(error,JSON.parse(body));
                });
            }
            ,function(hResult,callback){
                var user = Base.lookup({sClass:'User',hData:hResult});
                test.equal(user.getKey(),self.user.getKey());
                test.equal(hResult.follows.nTotal,nTestSize);

                callback();
            }
        ],function(err){ AppConfig.wrapTest(err,test); });
    }
    ,changeUserName:function(test) {
        // This test submits a save.json call on the existing user, changing his name.
        var self = this;
        test.expect(1);

        var sNewName = 'Dummy';
        async.waterfall([
            function(callback){
                request.post({uri:'http://localhost:'+nPort+'/user/'+self.user.getStrKey(),form:{name:sNewName,email:'test@test.com'}},function(error, response, body){
                    callback(error,body);
                });
            }
            ,function(body,callback){
                var hResult = JSON.parse(body);
                test.equal(hResult.name,sNewName);
                callback();
            }
        ],function(err){ AppConfig.wrapTest(err,test); });
    }
    ,badClassInRequest:function(test) {
        test.expect(1);

        async.waterfall([
            function(callback){
                request.post({uri:'http://localhost:'+nPort+'/badclass'},function(error, response, body){
                    test.equal(response.statusCode,500);
                    callback(error,body);
                });
            }
        ],function(err){ AppConfig.wrapTest(err,test); });
    }
    ,lookupUserByNumberID:function(test) {
        var self = this;
        test.expect(1);

        async.waterfall([
            function(callback){
                request.get({uri:'http://localhost:'+nPort+'/user/'+self.user.getKey()},function(error, response, body){
                    callback(error,JSON.parse(body));
                });
            }
            ,function(hResult,callback){
                var user = Base.lookup({sClass:'User',hData:hResult});
                test.equal(user.getKey(),self.user.getKey());
                callback();
            }
        ],function(err){ AppConfig.wrapTest(err,test); });
    }
    ,loadFollowersDirectly:function(test) {
        var self = this;
        test.expect(1);

        async.waterfall([
            function(callback){
                request.get({uri:'http://localhost:'+nPort+'/user/'+self.user.getStrKey()+'/follows'},function(error, response, body){
                    callback(error,body);
                });
            }
            ,function(body,callback){
                var follows = (body) ? JSON.parse(body) : {nTotal:0};
                test.equal(follows.nTotal,nTestSize);
                callback();
            }
        ],function(err){ AppConfig.wrapTest(err,test); });

    }
};