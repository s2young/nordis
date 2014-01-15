var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    AppConfig         = require('./../lib/AppConfig');

/**
 * This test creates a user and n follows (defined by nTestSize). Then, each test shows how to get a subset of those
 * follows in a paged collection. The test shows how to retrieve a collection from Redis (the framework's default) as
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
                    // Create n follower records  (n = nTestSize);
                    var createFollower = function(n,callback) {
                        // Create follow between newly created user and first user, as well as with previously created user.
                        var follower_user;
                        async.waterfall([
                            function(cb) {
                                follower_user = Base.lookup({sClass:'User'});
                                follower_user.set('name','TestFollower '+n);
                                follower_user.set('email','testfollower'+n+'@test.com');
                                follower_user.save(null,cb);
                            }
                            ,function(follower_user,cb) {
                                var follow = Base.lookup({sClass:'Follow'});
                                follow.set('followed_id',self.user.getKey());
                                follow.set('follower_id',follower_user.getKey());
                                // Store rank as an inverted number to show that we can sort by rank instead of id.
                                follow.set('rank',nTestSize-n);
                                follow.save(null,cb);
                            }
                            ,function(follower,cb) {
                                self.user.setExtra('follows',follower,cb);
                            }
                        ],callback);

                    };
                    var q = async.queue(createFollower,1000);
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
                var hQuery = {};
                hQuery[AppConfig.hClasses.Follow.sNumKeyProperty] = 'NOT NULL';
                new Collection({sClass:'Follow',hQuery:hQuery},function(err,cColl){
                    if (err)
                        cb(err);
                    else
                        cColl.delete(cb);
                });
            }
            ,function(cb){
                var hQuery = {};
                hQuery[AppConfig.hClasses.Follow.sNumKeyProperty] = 'NOT NULL';
                new Collection({sClass:'User',hQuery:hQuery},function(err,cColl){
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
                self.user.loadExtras({follows:{nSize:(nTestSize/2)}},cb);
            }
            ,function(o,cb){
                // nTotal will be the whole collection regardless of paging options.
                test.equal((self.user.follows.nNextID>0),true);
                test.equal(self.user.follows.nTotal,nTestSize);
                // nCount will be the number of items in the current page.
                test.equal(self.user.follows.nCount,(nTestSize/2));

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
                self.user.loadExtras({follows:{nSize:(nTestSize/2)}},cb);
            }
            ,function(o,cb){
                // Now, let's get the next half.
                self.user.loadExtras({follows:{nSize:(nTestSize/2),nFirstID:self.user.follows.nNextID}},cb);
            }
            ,function(o,cb){
                test.equal(self.user.follows.nNextID,undefined);
                // We should now have the second half of our list.
                test.equal(self.user.follows.nCount,(nTestSize/2));
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
                self.user.loadExtras({follows:{nSize:(nTestSize/5)}},cb);
            }
            ,function(o,cb){
                //AppConfig.log('Ranked items: '+(nTestSize-1)+' - '+(nTestSize-(nTestSize/5)));
                // Confirm paging is correct by testing the rank of the first and last items.
                test.equal(self.user.follows.first().get('rank'),(nTestSize-1));
                test.equal(self.user.follows.last().get('rank'),nTestSize-(nTestSize/5));
                // Let's get second 20% of the items.
                self.user.loadExtras({follows:{nSize:(nTestSize/5),nFirstID:self.user.follows.nNextID}},cb);
            }
            ,function(o,cb){
                //AppConfig.log('Ranked items: '+(nTestSize-(nTestSize/5)-1)+' - '+(nTestSize-((nTestSize/5)*2)));
                // Confirm paging is correct by testing the rank of the first and last items.
                test.equal(self.user.follows.first().get('rank'),nTestSize-(nTestSize/5)-1);
                test.equal(self.user.follows.last().get('rank'),nTestSize-((nTestSize/5)*2));
                // Let's get third 20% of the items.
                self.user.loadExtras({follows:{nSize:(nTestSize/5),nFirstID:self.user.follows.nNextID}},cb);
            }
            ,function(o,cb){
                //AppConfig.log('Ranked items: '+(nTestSize-((nTestSize/5)*2)-1)+' - '+(nTestSize-((nTestSize/5)*3)));
                // Confirm paging is correct by testing the rank of the first and last items.
                test.equal(self.user.follows.first().get('rank'),nTestSize-((nTestSize/5)*2)-1);
                test.equal(self.user.follows.last().get('rank'),nTestSize-((nTestSize/5)*3));
                // Let's get fourth 20% of the items.
                self.user.loadExtras({follows:{nSize:(nTestSize/5),nFirstID:self.user.follows.nNextID}},cb);
            }
            ,function(o,cb){
                //AppConfig.log('Ranked items: '+(nTestSize-((nTestSize/5)*3)-1)+' - '+(nTestSize-((nTestSize/5)*4)));
                // Confirm paging is correct by testing the rank of the first and last items.
                test.equal(self.user.follows.first().get('rank'),nTestSize-((nTestSize/5)*3)-1);
                test.equal(self.user.follows.last().get('rank'),nTestSize-((nTestSize/5)*4));
                // Let's get fifth 20% of the items.
                self.user.loadExtras({follows:{nSize:(nTestSize/5),nFirstID:self.user.follows.nNextID}},cb);
            }
            ,function(o,cb){
                test.equal(self.user.follows.last().get('rank'),0);
                test.equal(self.user.follows.nNextID,undefined);
                // We should now have the second half of our list.
                test.equal(self.user.follows.nCount,(nTestSize/5));
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
                self.user.loadExtras({sSource:'MySql',follows:{nSize:(nTestSize/2)}},cb);
            }
            ,function(o,cb){
                // nTotal will be the whole collection regardless of paging options.
                test.equal((self.user.follows.nNextID>0),true);
                test.equal(self.user.follows.nTotal,nTestSize);
                // nCount will be the number of items in the current page.
                test.equal(self.user.follows.nCount,(nTestSize/2));
                // The first item in the list should have an rank of nTestSize-1.
                test.equal(self.user.follows.first().get('rank'),(nTestSize-1));
                // And the last should have (nTestSize/2)
                test.equal(self.user.follows.last().get('rank'),(nTestSize/2));

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
                self.user.loadExtras({sSource:'MySql',follows:{nSize:(nTestSize/2)}},cb);
            }
            ,function(o,cb){
                // The first item in the list should have an rank of nTestSize-1.
                test.equal(self.user.follows.first().get('rank'),(nTestSize-1));
                // And the last should have (nTestSize/2)
                test.equal(self.user.follows.last().get('rank'),(nTestSize/2));

                // Now, let's get the next half.
                self.user.loadExtras({
                    sSource:'MySql',
                    follows:{
                        nSize:(nTestSize/2),
                        nFirstID:self.user.follows.nNextID}
                },cb);
            }
            ,function(o,cb){
                test.equal(self.user.follows.nNextID,undefined);

                // The first item in the list should have an rank of (nTestSize/2)-1.
                test.equal(self.user.follows.first().get('rank'),((nTestSize/2)-1));
                // And the last should have (nTestSize/2)
                test.equal(self.user.follows.last().get('rank'),0);

                // We should now have the second half of our list.
                test.equal(self.user.follows.nCount,(nTestSize/2));
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
                self.user.loadExtras({sSource:'MySql',follows:{nSize:(nTestSize/5)}},cb);
            }
            ,function(o,cb){
                //AppConfig.log('Ranked items: '+(nTestSize-1)+' - '+(nTestSize-(nTestSize/5)));
                // Confirm paging is correct by testing the rank of the first and last items.
                test.equal(self.user.follows.first().get('rank'),(nTestSize-1));
                test.equal(self.user.follows.last().get('rank'),nTestSize-(nTestSize/5));
                // Let's get second 20% of the items.
                self.user.loadExtras({sSource:'MySql',follows:{nSize:(nTestSize/5),nFirstID:self.user.follows.nNextID}},cb);
            }
            ,function(o,cb){
                //AppConfig.log('Ranked items: '+(nTestSize-(nTestSize/5)-1)+' - '+(nTestSize-((nTestSize/5)*2)));
                // Confirm paging is correct by testing the rank of the first and last items.
                test.equal(self.user.follows.first().get('rank'),nTestSize-(nTestSize/5)-1);
                test.equal(self.user.follows.last().get('rank'),nTestSize-((nTestSize/5)*2));
                // Let's get third 20% of the items.
                self.user.loadExtras({sSource:'MySql',follows:{nSize:(nTestSize/5),nFirstID:self.user.follows.nNextID}},cb);
            }
            ,function(o,cb){
                //AppConfig.log('Ranked items: '+(nTestSize-((nTestSize/5)*2)-1)+' - '+(nTestSize-((nTestSize/5)*3)));
                // Confirm paging is correct by testing the rank of the first and last items.
                test.equal(self.user.follows.first().get('rank'),nTestSize-((nTestSize/5)*2)-1);
                test.equal(self.user.follows.last().get('rank'),nTestSize-((nTestSize/5)*3));
                // Let's get fourth 20% of the items.
                self.user.loadExtras({sSource:'MySql',follows:{nSize:(nTestSize/5),nFirstID:self.user.follows.nNextID}},cb);
            }
            ,function(o,cb){
                //AppConfig.log('Ranked items: '+(nTestSize-((nTestSize/5)*3)-1)+' - '+(nTestSize-((nTestSize/5)*4)));
                // Confirm paging is correct by testing the rank of the first and last items.
                test.equal(self.user.follows.first().get('rank'),nTestSize-((nTestSize/5)*3)-1);
                test.equal(self.user.follows.last().get('rank'),nTestSize-((nTestSize/5)*4));
                // Let's get fifth 20% of the items.
                self.user.loadExtras({sSource:'MySql',follows:{nSize:(nTestSize/5),nFirstID:self.user.follows.nNextID}},cb);
            }
            ,function(o,cb){
                test.equal(self.user.follows.last().get('rank'),0);
                test.equal(self.user.follows.nNextID,undefined);
                // We should now have the second half of our list.
                test.equal(self.user.follows.nCount,(nTestSize/5));
                cb();
            }
        ],function(err){AppConfig.wrapTest(err,test)});
    }
};