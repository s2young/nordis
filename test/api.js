var express     = require('express'),
    async       = require('async'),
    request     = require('request'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    Middleware  = require('./../lib/Utils/Middleware'),
    App         = require('./../lib/AppConfig');

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
                self.user.save(null,cb);
            }
            ,function(cb) {
                // Create n friend records  (n = nTestSize);
                var createFriend = function(n,callback) {
                    var friend_user = Base.lookup({sClass:'User'});
                    friend_user.set('name','TestFriend '+n);
                    friend_user.set('email','testfriend'+n+'@test.com');
                    friend_user.save(null,function(err){
                        if (err)
                            callback(err);
                        else {
                            var friend = Base.lookup({sClass:'Friend'});
                            friend.set('user_id',self.user.getNumKey());
                            friend.set('friend_id',friend_user.getNumKey());
                            friend.set('rank',n);
                            friend.save(null,function(err){
                                callback(err);
                            });
                        }
                    });
                };
                var q = async.queue(createFriend,100);
                q.drain = cb;

                for (var n = 0; n < nTestSize; n++) {
                    q.push(n);
                }
            }
            // Next, fire up a temporary api running on port 2002. This is all that's needed for a simple api with no permission implications.
            ,function(cb) {
                App.init(null,function(err){
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
        async.waterfall([
            function(cb) {
                new Collection({sClass:'User',hQuery:{sWhere:'email IS NOT NULL'}},cb);
            }
            ,function(users,cb) {
                users.delete(cb);
            }
            ,function(ignore,cb){
                new Collection({sClass:'Friend',hQuery:{sWhere:App.hClasses.Friend.sNumKeyProperty+' IS NOT NULL'}},cb);
            }
            ,function(friends,cb) {
                friends.delete(cb);
            }
            ,function(ignore,cb){
                if (server)
                    server.close();
                cb();
            }
        ],callback)

    }
    ,lookupUser:function(test) {
        var self = this;
        test.expect(1);

        async.waterfall([
            function(callback){
                request.post({uri:'http://localhost:'+nPort+'/user/'+self.user.getStrKey()+'/details.json'},function(error, response, body){
                    callback(error,JSON.parse(body));
                });
            }
            ,function(hResult,callback){
                var user = Base.lookup({sClass:'User',hData:hResult});
                test.equal(user.getNumKey(),self.user.getNumKey());
                callback();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,lookupUserAndFriends:function(test) {
        var self = this;
        test.expect(2);

        // This time, we'll request the user's friends collection along with the user himself.
        var hData = {
            hExtras:{
                friends:{
                    hExtras:{
                        friend_user:true // We'll get each friend user object on the friends collection.
                    }
                }
            }
        };

        async.waterfall([
            function(callback){
                request.post({uri:'http://localhost:'+nPort+'/user/'+self.user.getStrKey()+'/details.json',form:hData},function(error, response, body){
                    callback(error,JSON.parse(body));
                });
            }
            ,function(hResult,callback){
                var user = Base.lookup({sClass:'User',hData:hResult});
                test.equal(user.getNumKey(),self.user.getNumKey());
                test.equal(hResult.friends.nTotal,nTestSize);

                callback();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,changeUserName:function(test) {
        // This test submits a save.json call on the existing user, changing his name.
        var self = this;
        test.expect(1);

        var sNewName = 'Dummy';
        async.waterfall([
            function(callback){
                request.post({uri:'http://localhost:'+nPort+'/user/'+self.user.getStrKey()+'/save.json',form:{name:sNewName}},function(error, response, body){
                    callback(error,body);
                });
            }
            ,function(body,callback){
                var hResult = JSON.parse(body);
                test.equal(hResult.name,sNewName);
                callback();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,badClassInRequest:function(test) {
        test.expect(1);

        async.waterfall([
            function(callback){
                request.post({uri:'http://localhost:'+nPort+'/badclass/new/details.json'},function(error, response, body){
                    test.equal(response.statusCode,500);
                    callback(error,body);
                });
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,lookupUserByNumberID:function(test) {
        var self = this;
        test.expect(1);

        async.waterfall([
            function(callback){
                request.post({uri:'http://localhost:'+nPort+'/user/'+self.user.getNumKey()+'/details.json'},function(error, response, body){
                    callback(error,JSON.parse(body));
                });
            }
            ,function(hResult,callback){
                var user = Base.lookup({sClass:'User',hData:hResult});
                test.equal(user.getNumKey(),self.user.getNumKey());
                callback();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,loadFriendsDirectly:function(test) {
        var self = this;
        test.expect(1);

        async.waterfall([
            function(callback){
                request.post({uri:'http://localhost:'+nPort+'/user/'+self.user.getStrKey()+'/friends.json'},function(error, response, body){
                    callback(error,body);
                });
            }
            ,function(body,callback){
                var friends = JSON.parse(body);
                test.equal(friends.nTotal,nTestSize);
                callback();
            }
        ],function(err){ App.wrapTest(err,test); });

    }
};