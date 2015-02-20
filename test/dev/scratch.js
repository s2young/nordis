var async       = require('async'),
    should      = require('should'),
    Base        = require('./../../lib/Base'),
    Collection  = require('./../../lib/Collection'),
    Config      = require('./../../lib/AppConfig');

/**
 * This test creates a user and n follows (defined by nTestSize). Then, each test shows how to get a subset of those
 * follows in a paged collection. The test shows how to retrieve a collection from Redis (the framework's default) as
 * well as how to specify that the collection come from MySql only.
 *
 * NOTE: nTestSize must be both divisible by two and five (i.e. use 10, 20, 30, etc as test size).
 *
 */
var nTestSize = 10;
var user;

module.exports = {
    collection:{
        paging:{
            beforeEach:function(done) {
                if (nTestSize < 5 || nTestSize%2 || nTestSize%2)
                    Config.error('nTestSize must be at least 5 and be divisble by 2 and 5.');
                else
                    async.series([
                        function(cb){
                            Collection.lookupAll({sClass:'Follow'},function(err,cColl){
                                if (err)
                                    cb(err);
                                else
                                    cColl.delete(cb);
                            });
                        }
                        ,function(cb){
                            Collection.lookupAll({sClass:'User'},function(err,cColl){
                                if (err)
                                    cb(err);
                                else
                                    cColl.delete(cb);
                            });
                        }
                        ,function(cb) {
                            user = Base.lookup({sClass:'User'});
                            user.set('name','TestUser');
                            user.set('email','test@test.com');
                            user.save(cb);
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
                                        follower_user.save(cb);
                                    }
                                    ,function(follower_user,cb) {
                                        var follow = Base.lookup({sClass:'Follow'});
                                        follow.set('followed_id',user.getKey());
                                        follow.set('follower_id',follower_user.getKey());
                                        // Store rank as an inverted number to show that we can sort by rank instead of id.
                                        follow.set('rank',nTestSize-n);
                                        follow.save(cb);
                                    }
                                    ,function(follower,cb) {
                                        user.setExtra('follows',follower,cb);
                                    }
                                ],callback);

                            };
                            var q = async.queue(createFollower,1000);
                            q.drain = cb;

                            for (var n = 1; n <= nTestSize; n++) {
                                q.push(n);
                            }
                        }
                    ],done);
            }
            ,afterEach:function(done) {
                this.timeout(30000);
                async.series([
                    function(cb){
                        Collection.lookupAll({sClass:'Follow'},function(err,cColl){
                            if (err)
                                cb(err);
                            else
                                cColl.delete(cb);
                        });
                    }
                    ,function(cb){
                        Collection.lookupAll({sClass:'User'},function(err,cColl){
                            if (err)
                                cb(err);
                            else
                                cColl.delete(cb);
                        });
                    }
                ],done);
            }
            //,getPageOne:function(done){
            //
            //    async.series([
            //        // Let's get half of the items in the collection.
            //        function(cb){
            //            user.loadExtras({follows:{nSize:(nTestSize/2),sSource:'MySql'}},cb);
            //        }
            //        // nTotal will be the whole collection regardless of paging options.
            //        ,function(cb){
            //            user.follows.nNextID.should.be.above(0);
            //            user.follows.sSource.should.equal('MySql');
            //            user.follows.nTotal.should.equal(nTestSize);
            //            // nCount will be the number of items in the current page.
            //            user.follows.nCount.should.equal((nTestSize/2));
            //            cb();
            //        }
            //        // Do it again, but this time look in Redis
            //        ,function(cb){
            //            user.loadExtras({follows:{nSize:(nTestSize/2),sSource:'Redis'}},cb);
            //        }
            //        ,function(cb){
            //            // nTotal will be the whole collection regardless of paging options.
            //            if (!Config.Redis.hOpts.default.bSkip) user.follows.sSource.should.equal('Redis');
            //            user.follows.nNextID.should.be.above(0);
            //            user.follows.nTotal.should.equal(nTestSize);
            //            // nCount will be the number of items in the current page.
            //            user.follows.nCount.should.equal((nTestSize/2));
            //            cb();
            //        }
            //    ],done);
            //}
            ,getCollectionInTwoPages:function(done){
                async.series([
                    function(cb){
                        // Let's get half of the items in the collection.
                        user.loadExtras({follows:{nSize:(nTestSize/2),sSource:'MySql'}},cb);
                    }
                    ,function(cb){
                        user.follows.sSource.should.equal('MySql');
                        cb();
                    }
                    ,function(cb){
                        console.log('PAGE 1');
                        console.log(user.follows);
                        // Now, let's get the next half.
                        user.loadExtras({follows:{nSize:(nTestSize/2),nFirstID:user.follows.nNextID}},cb);
                    }
                    ,function(cb){
                        console.log('PAGE 2');
                        console.log(user.follows);
                        if (Config.Redis.hOpts.default.bSkip)
                            user.follows.sSource.should.equal('MySql');
                        else
                            user.follows.sSource.should.equal('Redis');
                        (user.follows.nNextID===undefined).should.be.ok;
                        // We should now have the second half of our list.
                        user.follows.nCount.should.equal((nTestSize/2));
                        cb();
                    }
                ],done);
            }
            //,getCollectionInFivePages:function(done){
            //
            //    async.waterfall([
            //        function(cb){
            //            // Let's get first 20% of the items.
            //            user.loadExtras({follows:{nSize:(nTestSize/5)}},cb);
            //        }
            //        ,function(o,cb){
            //            //Config.log('Ranked items: '+(nTestSize-1)+' - '+(nTestSize-(nTestSize/5)));
            //            // Confirm paging is correct by testing the rank of the first and last items.
            //            user.follows.first().get('rank').should.equal((nTestSize-1));
            //            user.follows.last().get('rank').should.equal(nTestSize-(nTestSize/5));
            //            // Let's get second 20% of the items.
            //            user.loadExtras({follows:{nSize:(nTestSize/5),nFirstID:user.follows.nNextID}},cb);
            //        }
            //        ,function(o,cb){
            //            //Config.log('Ranked items: '+(nTestSize-(nTestSize/5)-1)+' - '+(nTestSize-((nTestSize/5)*2)));
            //            // Confirm paging is correct by testing the rank of the first and last items.
            //            user.follows.first().get('rank').should.equal(nTestSize-(nTestSize/5)-1);
            //            user.follows.last().get('rank').should.equal(nTestSize-((nTestSize/5)*2));
            //            // Let's get third 20% of the items.
            //            user.loadExtras({follows:{nSize:(nTestSize/5),nFirstID:user.follows.nNextID}},cb);
            //        }
            //        ,function(o,cb){
            //            //Config.log('Ranked items: '+(nTestSize-((nTestSize/5)*2)-1)+' - '+(nTestSize-((nTestSize/5)*3)));
            //            // Confirm paging is correct by testing the rank of the first and last items.
            //            user.follows.first().get('rank').should.equal(nTestSize-((nTestSize/5)*2)-1);
            //            user.follows.last().get('rank').should.equal(nTestSize-((nTestSize/5)*3));
            //            // Let's get fourth 20% of the items.
            //            user.loadExtras({follows:{nSize:(nTestSize/5),nFirstID:user.follows.nNextID}},cb);
            //        }
            //        ,function(o,cb){
            //            //Config.log('Ranked items: '+(nTestSize-((nTestSize/5)*3)-1)+' - '+(nTestSize-((nTestSize/5)*4)));
            //            // Confirm paging is correct by testing the rank of the first and last items.
            //            user.follows.first().get('rank').should.equal(nTestSize-((nTestSize/5)*3)-1);
            //            user.follows.last().get('rank').should.equal(nTestSize-((nTestSize/5)*4));
            //            // Let's get fifth 20% of the items.
            //            user.loadExtras({follows:{nSize:(nTestSize/5),nFirstID:user.follows.nNextID}},cb);
            //        }
            //        ,function(o,cb){
            //            user.follows.last().get('rank').should.equal(0);
            //            (user.follows.nNextID===undefined).should.be.ok;
            //            // We should now have the second half of our list.
            //            user.follows.nCount.should.equal((nTestSize/5));
            //            cb();
            //        }
            //    ],done);
            //}
            //,getPageOneMySql:function(done){
            //
            //    async.waterfall([
            //        function(cb){
            //            // Let's get half of the items in the collection.
            //            user.loadExtras({sSource:'MySql',follows:{nSize:(nTestSize/2)}},cb);
            //        }
            //        ,function(o,cb){
            //            // nTotal will be the whole collection regardless of paging options.
            //            user.follows.nNextID.should.be.above(0);
            //            user.follows.nTotal.should.equal(nTestSize);
            //            // nCount will be the number of items in the current page.
            //            user.follows.nCount.should.equal((nTestSize/2));
            //            // The first item in the list should have an rank of nTestSize-1.
            //            user.follows.first().get('rank').should.equal((nTestSize-1));
            //            // And the last should have (nTestSize/2)
            //            user.follows.last().get('rank').should.equal((nTestSize/2));
            //
            //            cb();
            //        }
            //    ],done);
            //}
            //,getCollectionInTwoPagesMySql:function(done){
            //
            //    async.waterfall([
            //        function(cb){
            //            // Let's get half of the items in the collection.
            //            user.loadExtras({sSource:'MySql',follows:{nSize:(nTestSize/2)}},cb);
            //        }
            //        ,function(o,cb){
            //            // The first item in the list should have an rank of nTestSize-1.
            //            user.follows.first().get('rank').should.equal((nTestSize-1));
            //            // And the last should have (nTestSize/2)
            //            user.follows.last().get('rank').should.equal((nTestSize/2));
            //
            //            // Now, let's get the next half.
            //            user.loadExtras({
            //                sSource:'MySql',
            //                follows:{
            //                    nSize:(nTestSize/2),
            //                    nFirstID:user.follows.nNextID
            //                }
            //            },cb);
            //        }
            //        ,function(o,cb){
            //            (user.follows.nNextID===undefined).should.be.ok;
            //
            //            // The first item in the list should have an rank of (nTestSize/2)-1.
            //            user.follows.first().get('rank').should.equal(((nTestSize/2)-1));
            //            // And the last should have (nTestSize/2)
            //            user.follows.last().get('rank').should.equal(0);
            //            // We should now have the second half of our list.
            //            user.follows.nCount.should.equal((nTestSize/2));
            //            cb();
            //        }
            //    ],done);
            //}
            //,getCollectionInFivePagesMySql:function(done){
            //
            //    async.waterfall([
            //        function(cb){
            //            // Let's get first 20% of the items.
            //            user.loadExtras({sSource:'MySql',follows:{nSize:(nTestSize/5)}},cb);
            //        }
            //        ,function(o,cb){
            //            //Config.log('Ranked items: '+(nTestSize-1)+' - '+(nTestSize-(nTestSize/5)));
            //            // Confirm paging is correct by testing the rank of the first and last items.
            //            user.follows.first().get('rank').should.equal((nTestSize-1));
            //            user.follows.last().get('rank').should.equal(nTestSize-(nTestSize/5));
            //            // Let's get second 20% of the items.
            //            user.loadExtras({sSource:'MySql',follows:{nSize:(nTestSize/5),nFirstID:user.follows.nNextID}},cb);
            //        }
            //        ,function(o,cb){
            //            //Config.log('Ranked items: '+(nTestSize-(nTestSize/5)-1)+' - '+(nTestSize-((nTestSize/5)*2)));
            //            // Confirm paging is correct by testing the rank of the first and last items.
            //            user.follows.first().get('rank').should.equal(nTestSize-(nTestSize/5)-1);
            //            user.follows.last().get('rank').should.equal(nTestSize-((nTestSize/5)*2));
            //            // Let's get third 20% of the items.
            //            user.loadExtras({sSource:'MySql',follows:{nSize:(nTestSize/5),nFirstID:user.follows.nNextID}},cb);
            //        }
            //        ,function(o,cb){
            //            //Config.log('Ranked items: '+(nTestSize-((nTestSize/5)*2)-1)+' - '+(nTestSize-((nTestSize/5)*3)));
            //            // Confirm paging is correct by testing the rank of the first and last items.
            //            user.follows.first().get('rank').should.equal(nTestSize-((nTestSize/5)*2)-1);
            //            user.follows.last().get('rank').should.equal(nTestSize-((nTestSize/5)*3));
            //            // Let's get fourth 20% of the items.
            //            user.loadExtras({sSource:'MySql',follows:{nSize:(nTestSize/5),nFirstID:user.follows.nNextID}},cb);
            //        }
            //        ,function(o,cb){
            //            //Config.log('Ranked items: '+(nTestSize-((nTestSize/5)*3)-1)+' - '+(nTestSize-((nTestSize/5)*4)));
            //            // Confirm paging is correct by testing the rank of the first and last items.
            //            user.follows.first().get('rank').should.equal(nTestSize-((nTestSize/5)*3)-1);
            //            user.follows.last().get('rank').should.equal(nTestSize-((nTestSize/5)*4));
            //            // Let's get fifth 20% of the items.
            //            user.loadExtras({sSource:'MySql',follows:{nSize:(nTestSize/5),nFirstID:user.follows.nNextID}},cb);
            //        }
            //        ,function(o,cb){
            //            user.follows.last().get('rank').should.equal(0);
            //            (user.follows.nNextID===undefined).should.be.ok;
            //            // We should now have the second half of our list.
            //            user.follows.nCount.should.equal((nTestSize/5));
            //            cb();
            //        }
            //    ],done);
            //}
        }
    }
};