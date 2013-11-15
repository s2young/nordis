var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    App         = require('./../lib/AppConfig');

/**
 * This test creates a user and n friends (defined by nTestSize). Then, each test shows how to get a subset of those
 * friends in a paged collection. The test shows how to retrieve a collection from Redis (the framework's default) as
 * well as how to specify that the collection come from MySql only.
 *
 * NOTE: nTestSize must be both divisible by two and five (i.e. use 10, 20, 30, etc as test size).
 *
 */
var nTestSize = 50;

module.exports = {
    setUp:function(callback) {
        var oSelf = this;

        if (nTestSize < 5 || nTestSize%2 || nTestSize%2)
            App.error('nTestSize must be at least 5 and be divisble by 2 and 5.');
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
                                oFriend.set('nUserID',oSelf.oUser.getNumKey());
                                oFriend.set('nFriendUserID',oFriendUser.getNumKey());
                                // Store rank as an inverted number to show that we can sort by rank instead of id.
                                oFriend.set('nRank',nTestSize-n);
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
        async.series([
            function(cb){
                new Collection({sClass:'Friend',hQuery:{sWhere:App.hClasses.Friend.sNumericKey+' IS NOT NULL'}},function(err,cColl){
                    if (err)
                        cb(err);
                    else
                        cColl.delete(cb);
                });
            }
            ,function(cb){
                new Collection({sClass:'User',hQuery:{sWhere:App.hClasses.User.sNumericKey+' IS NOT NULL'}},function(err,cColl){
                    if (err)
                        cb(err);
                    else
                        cColl.delete(cb);
                });
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
    ,getCollectionInTwoPages:function(test){
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
                cb();
            }
        ],function(err){App.wrapTest(err,test)});
    }
    ,getCollectionInFivePages:function(test){
        var oSelf = this;
        test.expect(11);

        async.waterfall([
            function(cb){
                // Let's get first 20% of the items.
                oSelf.oUser.loadExtras({cFriends:{nSize:(nTestSize/5)}},cb);
            }
            ,function(o,cb){
                //console.log('Ranked items: '+(nTestSize-1)+' - '+(nTestSize-(nTestSize/5)));
                // Confirm paging is correct by testing the nRank of the first and last items.
                test.equal(oSelf.oUser.cFriends.first().get('nRank'),(nTestSize-1));
                test.equal(oSelf.oUser.cFriends.last().get('nRank'),nTestSize-(nTestSize/5));
                // Let's get second 20% of the items.
                oSelf.oUser.loadExtras({cFriends:{nSize:(nTestSize/5),nFirstID:oSelf.oUser.cFriends.nNextID}},cb);
            }
            ,function(o,cb){
                //console.log('Ranked items: '+(nTestSize-(nTestSize/5)-1)+' - '+(nTestSize-((nTestSize/5)*2)));
                // Confirm paging is correct by testing the nRank of the first and last items.
                test.equal(oSelf.oUser.cFriends.first().get('nRank'),nTestSize-(nTestSize/5)-1);
                test.equal(oSelf.oUser.cFriends.last().get('nRank'),nTestSize-((nTestSize/5)*2));
                // Let's get third 20% of the items.
                oSelf.oUser.loadExtras({cFriends:{nSize:(nTestSize/5),nFirstID:oSelf.oUser.cFriends.nNextID}},cb);
            }
            ,function(o,cb){
                //console.log('Ranked items: '+(nTestSize-((nTestSize/5)*2)-1)+' - '+(nTestSize-((nTestSize/5)*3)));
                // Confirm paging is correct by testing the nRank of the first and last items.
                test.equal(oSelf.oUser.cFriends.first().get('nRank'),nTestSize-((nTestSize/5)*2)-1);
                test.equal(oSelf.oUser.cFriends.last().get('nRank'),nTestSize-((nTestSize/5)*3));
                // Let's get fourth 20% of the items.
                oSelf.oUser.loadExtras({cFriends:{nSize:(nTestSize/5),nFirstID:oSelf.oUser.cFriends.nNextID}},cb);
            }
            ,function(o,cb){
                //console.log('Ranked items: '+(nTestSize-((nTestSize/5)*3)-1)+' - '+(nTestSize-((nTestSize/5)*4)));
                // Confirm paging is correct by testing the nRank of the first and last items.
                test.equal(oSelf.oUser.cFriends.first().get('nRank'),nTestSize-((nTestSize/5)*3)-1);
                test.equal(oSelf.oUser.cFriends.last().get('nRank'),nTestSize-((nTestSize/5)*4));
                // Let's get fifth 20% of the items.
                oSelf.oUser.loadExtras({cFriends:{nSize:(nTestSize/5),nFirstID:oSelf.oUser.cFriends.nNextID}},cb);
            }
            ,function(o,cb){
                test.equal(oSelf.oUser.cFriends.last().get('nRank'),0);
                test.equal(oSelf.oUser.cFriends.nNextID,undefined);
                // We should now have the second half of our list.
                test.equal(oSelf.oUser.cFriends.nCount,(nTestSize/5));
                cb();
            }
        ],function(err){App.wrapTest(err,test)});
    }
    ,getPageOneMySql:function(test){
        var oSelf = this;
        test.expect(5);
        async.waterfall([
            function(cb){
                // Let's get half of the items in the collection.
                oSelf.oUser.loadExtras({sSource:'MySql',cFriends:{nSize:(nTestSize/2)}},cb);
            }
            ,function(o,cb){
                // nTotal will be the whole collection regardless of paging options.
                test.equal((oSelf.oUser.cFriends.nNextID>0),true);
                test.equal(oSelf.oUser.cFriends.nTotal,nTestSize);
                // nCount will be the number of items in the current page.
                test.equal(oSelf.oUser.cFriends.nCount,(nTestSize/2));
                // The first item in the list should have an nRank of nTestSize-1.
                test.equal(oSelf.oUser.cFriends.first().get('nRank'),(nTestSize-1));
                // And the last should have (nTestSize/2)
                test.equal(oSelf.oUser.cFriends.last().get('nRank'),(nTestSize/2));

                cb();
            }
        ],function(err){App.wrapTest(err,test)});
    }
    ,getCollectionInTwoPagesMySql:function(test){
        var oSelf = this;
        test.expect(6);
        async.waterfall([
            function(cb){
                // Let's get half of the items in the collection.
                oSelf.oUser.loadExtras({sSource:'MySql',cFriends:{nSize:(nTestSize/2)}},cb);
            }
            ,function(o,cb){
                // The first item in the list should have an nRank of nTestSize-1.
                test.equal(oSelf.oUser.cFriends.first().get('nRank'),(nTestSize-1));
                // And the last should have (nTestSize/2)
                test.equal(oSelf.oUser.cFriends.last().get('nRank'),(nTestSize/2));

                // Now, let's get the next half.
                oSelf.oUser.loadExtras({
                    sSource:'MySql',
                    cFriends:{
                        nSize:(nTestSize/2),
                        nFirstID:oSelf.oUser.cFriends.nNextID}
                },cb);
            }
            ,function(o,cb){
                test.equal(oSelf.oUser.cFriends.nNextID,undefined);

                // The first item in the list should have an nRank of (nTestSize/2)-1.
                test.equal(oSelf.oUser.cFriends.first().get('nRank'),((nTestSize/2)-1));
                // And the last should have (nTestSize/2)
                test.equal(oSelf.oUser.cFriends.last().get('nRank'),0);

                // We should now have the second half of our list.
                test.equal(oSelf.oUser.cFriends.nCount,(nTestSize/2));
                cb();
            }
        ],function(err){App.wrapTest(err,test)});
    }
    ,getCollectionInFivePagesMySql:function(test){
        var oSelf = this;
        test.expect(11);

        async.waterfall([
            function(cb){
                // Let's get first 20% of the items.
                oSelf.oUser.loadExtras({sSource:'MySql',cFriends:{nSize:(nTestSize/5)}},cb);
            }
            ,function(o,cb){
                //console.log('Ranked items: '+(nTestSize-1)+' - '+(nTestSize-(nTestSize/5)));
                // Confirm paging is correct by testing the nRank of the first and last items.
                test.equal(oSelf.oUser.cFriends.first().get('nRank'),(nTestSize-1));
                test.equal(oSelf.oUser.cFriends.last().get('nRank'),nTestSize-(nTestSize/5));
                // Let's get second 20% of the items.
                oSelf.oUser.loadExtras({sSource:'MySql',cFriends:{nSize:(nTestSize/5),nFirstID:oSelf.oUser.cFriends.nNextID}},cb);
            }
            ,function(o,cb){
                //console.log('Ranked items: '+(nTestSize-(nTestSize/5)-1)+' - '+(nTestSize-((nTestSize/5)*2)));
                // Confirm paging is correct by testing the nRank of the first and last items.
                test.equal(oSelf.oUser.cFriends.first().get('nRank'),nTestSize-(nTestSize/5)-1);
                test.equal(oSelf.oUser.cFriends.last().get('nRank'),nTestSize-((nTestSize/5)*2));
                // Let's get third 20% of the items.
                oSelf.oUser.loadExtras({sSource:'MySql',cFriends:{nSize:(nTestSize/5),nFirstID:oSelf.oUser.cFriends.nNextID}},cb);
            }
            ,function(o,cb){
                //console.log('Ranked items: '+(nTestSize-((nTestSize/5)*2)-1)+' - '+(nTestSize-((nTestSize/5)*3)));
                // Confirm paging is correct by testing the nRank of the first and last items.
                test.equal(oSelf.oUser.cFriends.first().get('nRank'),nTestSize-((nTestSize/5)*2)-1);
                test.equal(oSelf.oUser.cFriends.last().get('nRank'),nTestSize-((nTestSize/5)*3));
                // Let's get fourth 20% of the items.
                oSelf.oUser.loadExtras({sSource:'MySql',cFriends:{nSize:(nTestSize/5),nFirstID:oSelf.oUser.cFriends.nNextID}},cb);
            }
            ,function(o,cb){
                //console.log('Ranked items: '+(nTestSize-((nTestSize/5)*3)-1)+' - '+(nTestSize-((nTestSize/5)*4)));
                // Confirm paging is correct by testing the nRank of the first and last items.
                test.equal(oSelf.oUser.cFriends.first().get('nRank'),nTestSize-((nTestSize/5)*3)-1);
                test.equal(oSelf.oUser.cFriends.last().get('nRank'),nTestSize-((nTestSize/5)*4));
                // Let's get fifth 20% of the items.
                oSelf.oUser.loadExtras({sSource:'MySql',cFriends:{nSize:(nTestSize/5),nFirstID:oSelf.oUser.cFriends.nNextID}},cb);
            }
            ,function(o,cb){
                test.equal(oSelf.oUser.cFriends.last().get('nRank'),0);
                test.equal(oSelf.oUser.cFriends.nNextID,undefined);
                // We should now have the second half of our list.
                test.equal(oSelf.oUser.cFriends.nCount,(nTestSize/5));
                cb();
            }
        ],function(err){App.wrapTest(err,test)});
    }
};