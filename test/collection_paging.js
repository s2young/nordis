var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    App         = require('./../lib/AppConfig');

/**
 * This test creates friends on friends on friends and shows how to look up a user, his friends and his friends friends.
 *
 * @type {number}
 */

var nTestSize = 2;

module.exports = {
    setUp:function(callback) {
        var oSelf = this;

        if (nTestSize < 2 || nTestSize%2)
            App.error('nTestSize must be at least 2 and be divisble by two.');
        else
            async.series([
                function(cb) {
                    oSelf.oUser = Base.lookup({sClass:'User'});
                    oSelf.oUser.set('sName','TestUser');
                    oSelf.oUser.set('sEmail','test@test.com');
                    oSelf.oUser.save(null,cb);
                }
                ,function(cb) {
                    // Create n friend records  (n = nTestSize);
                    var createFriend = function(n,callback) {
                        // Create friendship between newly created user and first user, as well as with previously created user.
                        var oFriendUser;
                        async.waterfall([
                            function(cb) {
                                oFriendUser = Base.lookup({sClass:'User'});
                                oFriendUser.set('sName','TestFriend '+n);
                                oFriendUser.set('sEmail','testfriend'+n+'@test.com');
                                oFriendUser.save(null,cb);
                            }
                            ,function(oFriendUser,cb) {
                                var oFriend = Base.lookup({sClass:'Friend'});
                                oFriend.set('nUserID',oSelf.oUser.get('nID'));
                                oFriend.set('nFriendUserID',oFriendUser.get('nID'));
                                oFriend.save(null,cb);
                            }
                            ,function(oFriend,cb) {
                                oSelf.oUser.setExtra('cFriends',oFriend,cb);
                            }
                        ],callback);

                    };
                    var q = async.queue(createFriend,1000);
                    q.drain = cb;

                    for (var n = 1; n <= nTestSize; n++) {
                        q.push(n);
                    }
                }
            ],callback);
    }
    ,tearDown:function(callback) {
        var oSelf = this;
        async.series([
            function(cb){
                // Lookup the user's friends and the user objects associated with those friend records so we can remove them.
                oSelf.oUser.loadExtras({cFriends:true},cb);
            }
            ,function(cb){
                // Now delete the cFriends collection.
                oSelf.oUser.cFriends.delete(cb);
            }
            ,function(cb){
                // And finally the oUser.
                oSelf.oUser.delete(cb);
            }
        ],callback);
    }
    ,getPageOne:function(test){
        var oSelf = this;
        test.expect(3);

        async.waterfall([
            function(cb){
                // Let's get half of the items in the collection.
                oSelf.oUser.loadExtras({cFriends:{nSize:(nTestSize/2)}},cb);
            }
            ,function(o,cb){
                // nTotal will be the whole collection regardless of paging options.
                test.equal((oSelf.oUser.cFriends.nNextID>0),true);
                test.equal(oSelf.oUser.cFriends.nTotal,nTestSize);
                // nCount will be the number of items in the current page.
                test.equal(oSelf.oUser.cFriends.nCount,(nTestSize/2));

                cb();
            }
        ],function(err){App.wrapTest(err,test)});
    }
    ,getPageOneAndTwo:function(test){
        var oSelf = this;
        test.expect(2);

        async.waterfall([
            function(cb){
                // Let's get half of the items in the collection.
                oSelf.oUser.loadExtras({cFriends:{nSize:(nTestSize/2)}},cb);
            }
            ,function(o,cb){
                // Now, let's get the next half.
                oSelf.oUser.loadExtras({cFriends:{nSize:(nTestSize/2),nFirstID:oSelf.oUser.cFriends.nNextID}},cb);
            }
            ,function(o,cb){
                test.equal(oSelf.oUser.cFriends.nNextID,undefined);
                // We should now have the second half of our list.
                test.equal(oSelf.oUser.cFriends.nCount,(nTestSize/2));
            }
        ],function(err){App.wrapTest(err,test)});
    }
};