var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    AppConfig         = require('./../lib/AppConfig');

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
        var self = this;

        if (nTestSize < 5 || nTestSize%2 || nTestSize%2)
            AppConfig.error('nTestSize must be at least 5 and be divisble by 2 and 5.');
        else
            async.series([
                function(cb) {
                    self.user = Base.lookup({sClass:'User'});
                    self.user.set('name','TestUser');
                    self.user.set('email','test@test.com');
                    self.user.save(null,cb);
                }
                ,function(cb) {
                    // Create n friend records  (n = nTestSize);
                    var createFriend = function(n,callback) {
                        // Create friendship between newly created user and first user, as well as with previously created user.
                        var friend_user;
                        async.waterfall([
                            function(cb) {
                                friend_user = Base.lookup({sClass:'User'});
                                friend_user.set('name','TestFriend '+n);
                                friend_user.set('email','testfriend'+n+'@test.com');
                                friend_user.save(null,cb);
                            }
                            ,function(friend_user,cb) {
                                var friend = Base.lookup({sClass:'Friend'});
                                friend.set('user_id',self.user.getKey());
                                friend.set('friend_id',friend_user.getKey());
                                // Store rank as an inverted number to show that we can sort by rank instead of id.
                                friend.set('rank',nTestSize-n);
                                friend.save(null,cb);
                            }
                            ,function(friend,cb) {
                                self.user.setExtra('friends',friend,cb);
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
                new Collection({sClass:'Friend',hQuery:{sWhere:AppConfig.hClasses.Friend.sNumKeyProperty+' IS NOT NULL'}},function(err,cColl){
                    if (err)
                        cb(err);
                    else
                        cColl.delete(cb);
                });
            }
            ,function(cb){
                new Collection({sClass:'User',hQuery:{sWhere:AppConfig.hClasses.User.sNumKeyProperty+' IS NOT NULL'}},function(err,cColl){
                    if (err)
                        cb(err);
                    else
                        cColl.delete(cb);
                });
            }
        ],callback);
    }
    ,getPageOne:function(test){
        var self = this;
        test.expect(3);

        async.waterfall([
            function(cb){
                // Let's get half of the items in the collection.
                self.user.loadExtras({friends:{nSize:(nTestSize/2)}},cb);
            }
            ,function(o,cb){
                // nTotal will be the whole collection regardless of paging options.
                test.equal((self.user.friends.nNextID>0),true);
                test.equal(self.user.friends.nTotal,nTestSize);
                // nCount will be the number of items in the current page.
                test.equal(self.user.friends.nCount,(nTestSize/2));

                cb();
            }
        ],function(err){AppConfig.wrapTest(err,test)});
    }
    ,getCollectionInTwoPages:function(test){
        var self = this;
        test.expect(2);

        async.waterfall([
            function(cb){
                // Let's get half of the items in the collection.
                self.user.loadExtras({friends:{nSize:(nTestSize/2)}},cb);
            }
            ,function(o,cb){
                // Now, let's get the next half.
                self.user.loadExtras({friends:{nSize:(nTestSize/2),nFirstID:self.user.friends.nNextID}},cb);
            }
            ,function(o,cb){
                test.equal(self.user.friends.nNextID,undefined);
                // We should now have the second half of our list.
                test.equal(self.user.friends.nCount,(nTestSize/2));
                cb();
            }
        ],function(err){AppConfig.wrapTest(err,test)});
    }
    ,getCollectionInFivePages:function(test){
        var self = this;
        test.expect(11);

        async.waterfall([
            function(cb){
                // Let's get first 20% of the items.
                self.user.loadExtras({friends:{nSize:(nTestSize/5)}},cb);
            }
            ,function(o,cb){
                //AppConfig.log('Ranked items: '+(nTestSize-1)+' - '+(nTestSize-(nTestSize/5)));
                // Confirm paging is correct by testing the rank of the first and last items.
                test.equal(self.user.friends.first().get('rank'),(nTestSize-1));
                test.equal(self.user.friends.last().get('rank'),nTestSize-(nTestSize/5));
                // Let's get second 20% of the items.
                self.user.loadExtras({friends:{nSize:(nTestSize/5),nFirstID:self.user.friends.nNextID}},cb);
            }
            ,function(o,cb){
                //AppConfig.log('Ranked items: '+(nTestSize-(nTestSize/5)-1)+' - '+(nTestSize-((nTestSize/5)*2)));
                // Confirm paging is correct by testing the rank of the first and last items.
                test.equal(self.user.friends.first().get('rank'),nTestSize-(nTestSize/5)-1);
                test.equal(self.user.friends.last().get('rank'),nTestSize-((nTestSize/5)*2));
                // Let's get third 20% of the items.
                self.user.loadExtras({friends:{nSize:(nTestSize/5),nFirstID:self.user.friends.nNextID}},cb);
            }
            ,function(o,cb){
                //AppConfig.log('Ranked items: '+(nTestSize-((nTestSize/5)*2)-1)+' - '+(nTestSize-((nTestSize/5)*3)));
                // Confirm paging is correct by testing the rank of the first and last items.
                test.equal(self.user.friends.first().get('rank'),nTestSize-((nTestSize/5)*2)-1);
                test.equal(self.user.friends.last().get('rank'),nTestSize-((nTestSize/5)*3));
                // Let's get fourth 20% of the items.
                self.user.loadExtras({friends:{nSize:(nTestSize/5),nFirstID:self.user.friends.nNextID}},cb);
            }
            ,function(o,cb){
                //AppConfig.log('Ranked items: '+(nTestSize-((nTestSize/5)*3)-1)+' - '+(nTestSize-((nTestSize/5)*4)));
                // Confirm paging is correct by testing the rank of the first and last items.
                test.equal(self.user.friends.first().get('rank'),nTestSize-((nTestSize/5)*3)-1);
                test.equal(self.user.friends.last().get('rank'),nTestSize-((nTestSize/5)*4));
                // Let's get fifth 20% of the items.
                self.user.loadExtras({friends:{nSize:(nTestSize/5),nFirstID:self.user.friends.nNextID}},cb);
            }
            ,function(o,cb){
                test.equal(self.user.friends.last().get('rank'),0);
                test.equal(self.user.friends.nNextID,undefined);
                // We should now have the second half of our list.
                test.equal(self.user.friends.nCount,(nTestSize/5));
                cb();
            }
        ],function(err){AppConfig.wrapTest(err,test)});
    }
    ,getPageOneMySql:function(test){
        var self = this;
        test.expect(5);
        async.waterfall([
            function(cb){
                // Let's get half of the items in the collection.
                self.user.loadExtras({sSource:'MySql',friends:{nSize:(nTestSize/2)}},cb);
            }
            ,function(o,cb){
                // nTotal will be the whole collection regardless of paging options.
                test.equal((self.user.friends.nNextID>0),true);
                test.equal(self.user.friends.nTotal,nTestSize);
                // nCount will be the number of items in the current page.
                test.equal(self.user.friends.nCount,(nTestSize/2));
                // The first item in the list should have an rank of nTestSize-1.
                test.equal(self.user.friends.first().get('rank'),(nTestSize-1));
                // And the last should have (nTestSize/2)
                test.equal(self.user.friends.last().get('rank'),(nTestSize/2));

                cb();
            }
        ],function(err){AppConfig.wrapTest(err,test)});
    }
    ,getCollectionInTwoPagesMySql:function(test){
        var self = this;
        test.expect(6);
        async.waterfall([
            function(cb){
                // Let's get half of the items in the collection.
                self.user.loadExtras({sSource:'MySql',friends:{nSize:(nTestSize/2)}},cb);
            }
            ,function(o,cb){
                // The first item in the list should have an rank of nTestSize-1.
                test.equal(self.user.friends.first().get('rank'),(nTestSize-1));
                // And the last should have (nTestSize/2)
                test.equal(self.user.friends.last().get('rank'),(nTestSize/2));

                // Now, let's get the next half.
                self.user.loadExtras({
                    sSource:'MySql',
                    friends:{
                        nSize:(nTestSize/2),
                        nFirstID:self.user.friends.nNextID}
                },cb);
            }
            ,function(o,cb){
                test.equal(self.user.friends.nNextID,undefined);

                // The first item in the list should have an rank of (nTestSize/2)-1.
                test.equal(self.user.friends.first().get('rank'),((nTestSize/2)-1));
                // And the last should have (nTestSize/2)
                test.equal(self.user.friends.last().get('rank'),0);

                // We should now have the second half of our list.
                test.equal(self.user.friends.nCount,(nTestSize/2));
                cb();
            }
        ],function(err){AppConfig.wrapTest(err,test)});
    }
    ,getCollectionInFivePagesMySql:function(test){
        var self = this;
        test.expect(11);

        async.waterfall([
            function(cb){
                // Let's get first 20% of the items.
                self.user.loadExtras({sSource:'MySql',friends:{nSize:(nTestSize/5)}},cb);
            }
            ,function(o,cb){
                //AppConfig.log('Ranked items: '+(nTestSize-1)+' - '+(nTestSize-(nTestSize/5)));
                // Confirm paging is correct by testing the rank of the first and last items.
                test.equal(self.user.friends.first().get('rank'),(nTestSize-1));
                test.equal(self.user.friends.last().get('rank'),nTestSize-(nTestSize/5));
                // Let's get second 20% of the items.
                self.user.loadExtras({sSource:'MySql',friends:{nSize:(nTestSize/5),nFirstID:self.user.friends.nNextID}},cb);
            }
            ,function(o,cb){
                //AppConfig.log('Ranked items: '+(nTestSize-(nTestSize/5)-1)+' - '+(nTestSize-((nTestSize/5)*2)));
                // Confirm paging is correct by testing the rank of the first and last items.
                test.equal(self.user.friends.first().get('rank'),nTestSize-(nTestSize/5)-1);
                test.equal(self.user.friends.last().get('rank'),nTestSize-((nTestSize/5)*2));
                // Let's get third 20% of the items.
                self.user.loadExtras({sSource:'MySql',friends:{nSize:(nTestSize/5),nFirstID:self.user.friends.nNextID}},cb);
            }
            ,function(o,cb){
                //AppConfig.log('Ranked items: '+(nTestSize-((nTestSize/5)*2)-1)+' - '+(nTestSize-((nTestSize/5)*3)));
                // Confirm paging is correct by testing the rank of the first and last items.
                test.equal(self.user.friends.first().get('rank'),nTestSize-((nTestSize/5)*2)-1);
                test.equal(self.user.friends.last().get('rank'),nTestSize-((nTestSize/5)*3));
                // Let's get fourth 20% of the items.
                self.user.loadExtras({sSource:'MySql',friends:{nSize:(nTestSize/5),nFirstID:self.user.friends.nNextID}},cb);
            }
            ,function(o,cb){
                //AppConfig.log('Ranked items: '+(nTestSize-((nTestSize/5)*3)-1)+' - '+(nTestSize-((nTestSize/5)*4)));
                // Confirm paging is correct by testing the rank of the first and last items.
                test.equal(self.user.friends.first().get('rank'),nTestSize-((nTestSize/5)*3)-1);
                test.equal(self.user.friends.last().get('rank'),nTestSize-((nTestSize/5)*4));
                // Let's get fifth 20% of the items.
                self.user.loadExtras({sSource:'MySql',friends:{nSize:(nTestSize/5),nFirstID:self.user.friends.nNextID}},cb);
            }
            ,function(o,cb){
                test.equal(self.user.friends.last().get('rank'),0);
                test.equal(self.user.friends.nNextID,undefined);
                // We should now have the second half of our list.
                test.equal(self.user.friends.nCount,(nTestSize/5));
                cb();
            }
        ],function(err){AppConfig.wrapTest(err,test)});
    }
};