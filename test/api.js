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
        var oSelf = this;
        async.series([
            // Create a user we'll look up via an api call.
            function(cb){
                oSelf.oUser = Base.lookup({sClass:'User'});
                oSelf.oUser.set('sName','TestUser');
                oSelf.oUser.set('sEmail','test@test.com');
                oSelf.oUser.save(null,cb);
            }
            ,function(cb) {
                // Create n friend records  (n = nTestSize);
                var createFriend = function(n,callback) {
                    var oFriendUser = Base.lookup({sClass:'User'});
                    oFriendUser.set('sName','TestFriend '+n);
                    oFriendUser.set('sEmail','testfriend'+n+'@test.com');
                    oFriendUser.save(null,function(err){
                        if (err)
                            callback(err);
                        else {
                            var oFriend = Base.lookup({sClass:'Friend'});
                            oFriend.set('nUserID',oSelf.oUser.get('nID'));
                            oFriend.set('nFriendUserID',oFriendUser.get('nID'));
                            oFriend.set('nRank',n);
                            oFriend.save(null,function(err){
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
                new Collection({sClass:'User',hQuery:{sWhere:'sEmail IS NOT NULL'}},cb);
            }
            ,function(cColl,cb) {
                cColl.delete(cb);
            }
            ,function(ignore,cb){
                new Collection({sClass:'Friend',hQuery:{sWhere:'nID IS NOT NULL'}},cb);
            }
            ,function(cColl,cb) {
                cColl.delete(cb);
            }
            ,function(ignore,cb){
                if (server)
                    server.close();
                cb();
            }
        ],callback)

    }
    ,lookupUser:function(test) {
        var oSelf = this;
        test.expect(1);

        async.waterfall([
            function(callback){
                request.post({uri:'http://localhost:'+nPort+'/user/'+oSelf.oUser.get('sID')+'/details.json'},function(error, response, body){
                    callback(error,body);
                });
            }
            ,function(body,callback){
                var hResult = JSON.parse(body);
                test.equal(hResult.nUserID,oSelf.oUser.get('nID'));
                callback();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,lookupUserAndFriends:function(test) {
        var oSelf = this;
        test.expect(2);

        // This time, we'll request the user's friends collection along with the user himself.
        var hData = {
            hExtras:{
                cFriends:{
                    hExtras:{
                        oFriendUser:true // We'll get each friend user object on the cFriends collection.
                    }
                }
            }
        };

        async.waterfall([
            function(callback){
                request.post({uri:'http://localhost:'+nPort+'/user/'+oSelf.oUser.get('sID')+'/details.json',form:hData},function(error, response, body){
                    callback(error,body);
                });
            }
            ,function(body,callback){
                var hResult = JSON.parse(body);
                test.equal(hResult.nUserID,oSelf.oUser.get('nID'));
                test.equal(hResult.cFriends.nTotal,nTestSize);

                callback();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,changeUserName:function(test) {
        // This test submits a save.json call on the existing user, changing his name.
        var oSelf = this;
        test.expect(1);

        var sNewName = 'Dummy';
        async.waterfall([
            function(callback){
                request.post({uri:'http://localhost:'+nPort+'/user/'+oSelf.oUser.get('sID')+'/save.json',form:{sName:sNewName}},function(error, response, body){
                    callback(error,body);
                });
            }
            ,function(body,callback){
                var hResult = JSON.parse(body);
                test.equal(hResult.sName,sNewName);
                callback();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,badClassInRequest:function(test) {
        var oSelf = this;
        test.expect(1);

        async.waterfall([
            function(callback){
                request.post({uri:'http://localhost:'+nPort+'/badclass/new/details.json'},function(error, response, body){
                    callback(error,body);
                });
            }
            ,function(body,callback){
                var hResult = JSON.parse(body);
                console.log(hResult);
                test.equal(hResult.sName,sNewName);
                callback();
            }
        ],function(err){ App.wrapTest(err,test); });
    }

};