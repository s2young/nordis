var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    App         = require('./../lib/AppConfig');

var nTestSize = 1000;
module.exports = {
    setUp:function(callback) {
        var oSelf = this;
        // Create empty Base object of class 'User.'
        async.series([
            function(cb) {
                oSelf.oUser = Base.lookup({sClass:'User'});
                oSelf.oUser.set('sName','TestUser');
                oSelf.oUser.set('sEmail','test@test.com');
                oSelf.oUser.save(null,cb);
            }
            ,function(cb){
                // Create but don't save the friend object.
                oSelf.oFriend = Base.lookup({sClass:'User'});
                oSelf.oFriend.set('sName','TestUser\'s Friend');
                oSelf.oFriend.set('sEmail','friend@test.com');
                cb();
            }
        ],callback);
    }
    ,tearDown:function(callback) {
        var oSelf = this;

        async.parallel([
            function(cb){
                oSelf.oUser.delete(cb);
            }
            ,function(cb){
                oSelf.oFriend.delete(cb);
            }
        ],callback);
    }
    ,saveReferringUser:function(test) {
        var oSelf = this;
        test.expect(1);

        async.series([
            function(callback) {
                // This will both save the oFriend and set the oUser.nReferringUserID
                oSelf.oUser.setExtra('oReferringUser',oSelf.oFriend,callback);
            }
            ,function(callback) {
                test.equal(oSelf.oUser.get('nReferringUserID'),oSelf.oFriend.get('nID'));
                callback();
            }
        ],function(err){ App.wrapTest(err,test); })

    }
    ,lookupUserOnly:function(test){
        var oSelf = this;
        test.expect(1);

        var nStart;
        async.waterfall([
            function(callback) {
                nStart = new Date().getTime();
                // Lookup user by primary key (nID) and request some extras.
                Base.lookup({
                    sClass:'User'
                    ,hQuery:{nID:oSelf.oUser.get('nID')}
                },callback);
            }
            ,function(oUser,callback){
                console.log('Lookup time for primary key lookup of user only: '+(new Date().getTime()-nStart)+' ms\n');
                test.equal(oUser.get('nID'),oSelf.oUser.get('nID'));
                callback();
            }
        ],function(err){ App.wrapTest(err,test); })

    }
    ,lookupUserAndExtras:function(test){
        var oSelf = this;
        test.expect(3);

        var nStart;
        async.waterfall([
            function(callback) {
                // This will both save the oFriend and set the oUser.nReferringUserID
                oSelf.oUser.setExtra('oReferringUser',oSelf.oFriend,callback);
            }
            ,function(oUser,callback) {
                test.equal(oSelf.oUser.get('nReferringUserID'),oSelf.oFriend.get('nID'));

                nStart = new Date().getTime();
                // Lookup user by primary key (nID) and request some extras.
                Base.lookup({
                    sClass:'User'
                    ,hQuery:{nID:oSelf.oUser.get('nID')}
                    ,hExtras:{oReferringUser:true}
                },callback);
            }
            ,function(oUser,callback){
                console.log('Lookup time for primary key lookup of user + one object extra: '+(new Date().getTime()-nStart)+' ms\n');
                test.equal(oUser.get('nID'),oSelf.oUser.get('nID'));
                test.equal(oUser.oReferringUser.get('nID'),oSelf.oUser.get('nReferringUserID'));
                callback();
            }
        ],function(err){ App.wrapTest(err,test); })

    }
    ,deleteReferringUser:function(test){
        // What if the referring user is removed?  The references to it in the referred user should also be removed.
        var oSelf = this;
        test.expect(3);

        async.waterfall([
            function(callback) {
                // Add the friend as the referring user.
                oSelf.oUser.setExtra('oReferringUser',oSelf.oFriend,callback);
            }
            ,function(oUser,callback) {
                test.equal(oSelf.oUser.get('nReferringUserID'),oSelf.oFriend.get('nID'));
                // Now, delete the friend.
                oSelf.oFriend.delete(callback);
            }
            ,function(oUser,callback){
                // Now, try and lookup the friend (oFriend) via the referred user (oUser).
                Base.lookup({
                    sClass:'User'
                    ,hQuery:{nID:oSelf.oUser.get('nID')}
                    ,hExtras:{oReferringUser:true}
                },callback);
            }
            ,function(oUser,callback){
                test.equal(oUser.get('nID'),oSelf.oUser.get('nID'));
                test.equal(oUser.oReferringUser.get('nID'),null);
                callback();
            }
        ],function(err){ App.wrapTest(err,test); })
    }
};