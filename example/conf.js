/**
 *
 *
 */
module.exports.hSettings = {
    global: {
        nSeedID:1000000
        ,sLanguage:'en'
        ,sLogLevel:'warn'
        ,hOptions:{
            MySql:{
                sSchema:'nordis',
                sHost:'localhost',
                sUser:'root',
                nMaxConnections:10,
                nTimeoutMilliseconds:10000,
                bDebugMode:false,
                bSkip:false
            },
            Redis:{
                sWriteServer:'127.0.0.1',
                nWritePort:6379,
                nMaxConnections:200,
                nTimeoutMilliseconds:3000,
                nReapIntervalMilliseconds:2000,
                bDebugMode:false,
                bSkip:false
            }
        }
        ,hApi:{
            sTitle:'Nordis Sample API'
            ,sDescription:'This API is a simple output of the classes provided in this simple configuration example. No authentication is required for any endpoint, but real-world examples should include it.'
            ,sHost:'http://api.example.com'
        }
        ,hClasses:{
            User:{
                hProperties:{
                    id:{
                        sType:'Number'
                        ,bUnique:true
                        ,sSample:'123'
                    }
                    ,sid:{
                        sType:'String'
                        ,bUnique:true
                        ,nLength:36
                        ,sSample:'Yf8uIoP'
                    }
                    ,created:{
                        sType:'Timestamp'
                        ,bOnCreate:true
                        ,sSample:'1389625960'
                    }
                    ,updated:{
                        sType:'Timestamp'
                        ,bOnUpdate:true
                        ,sSample:'1389625960'
                    }
                    ,name:{
                        sType:'String'
                        ,sSample:'Joe User'
                    }
                    ,password:{
                        sType:'String'
                        ,bPrivate:true
                        ,sSample:'password'
                    }
                    ,email:{
                        sType:'String'
                        ,bUnique:true
                        ,sSample:'joe@gmail.com'
                    }
                    ,referrer_id:{
                        sType:'Number'
                        ,sSample:null
                    }
                }
                ,nClass:1
                ,hExtras:{
                    points:{sType:'Increment'}
                    ,friends:{
                        sType:'Collection'
                        ,sClass:'Friend'
                        ,sOrderBy:'rank'
                        ,bReverse:true
                        ,fnQuery:function(oSelf){
                            return {user_id:oSelf.getNumKey()}
                        }
                    }
                    ,referring_user:{
                        sType:'Object'
                        ,sClass:'User'
                        ,aKey:['referrer_id','id']
                        ,fnQuery:function(oObj){
                            return {id:oObj.get('referrer_id')}
                        }
                    }
                }
                ,hApi:{
                    sDescription:'Users are usually people, but can sometimes be bots. Users can be created, saved and deleted. These methods are marked unprotected, but a security layer can be applied via custom handler or here in configuration using the fnValidate function.'
                    ,hEndpoints:{
                        '/user/{sid}':{
                            sDescription:'Retrieve, update and delete user.'
                            ,hParameters:{
                                sid:{
                                    bRequired:true
                                    ,sType:'String'
                                    ,sExample:'Yf8uIoP'
                                    ,sDescription:'String id of the user record. Numeric ids are also supported.'
                                }
                            }
                            ,hVerbs:{
                                POST:{
                                    sTitle:'Update (or Create) User'
                                    ,sDescription:'You can also create a NEW user by leaving the sid out.'
                                    ,bProtected:false
                                    ,bTrackStats:true
                                    ,fnApiOutput:function(oSelf,App){
                                        // Nordis has a toHash method as the default serialization for each class, but you can override it here.
                                        return oSelf.toHash();
                                    }
                                }
                                ,GET:{
                                    sTitle:'Retrieve a User'
                                    ,sDescription:'You can retrieve any of the \'hExtras\' configured for the class using the hExtras parameter in the GET call. In the following example, we want to retrieve the user\'s \'friends\' collection up to a total of ONE record (nSize:1). On that friend, we want the related friend_user property (which is a User object).\n\n            {"hExtras":{friends:{nSize:1,hExtras:{friend_user:true}}}}'
                                    ,bProtected:false
                                    ,bTrackStats:true
                                }
                                ,DELETE:{
                                    sTitle:'Delete a User'
                                    ,bProtected:false
                                    ,bTrackStats:true
                                }
                            }
                        }
                    }
                }
            }
            ,Friend:{
                hProperties:{
                    id:{
                        sType:'Number',
                        bUnique:true
                    }
                    ,user_id:{
                        sType:'Number'
                    }
                    ,friend_id:{
                        sType:'Number'
                    }
                    ,rank:{
                        sType:'Number'
                    }
                }
                ,nClass:2
                ,hExtras:{
                    user:{
                        sType:'Object'
                        ,sClass:'User'
                        ,aKey:['user_id','id']
                        ,fnQuery:function(oSelf){
                            return {id:oSelf.get('user_id')}
                        }
                    }
                    ,friend_user:{
                        sType:'Object'
                        ,sClass:'User'
                        ,aKey:['friend_id','id']
                        ,fnQuery:function(oSelf){
                            return {nID:oSelf.get('friend_id')}
                        }
                    }
                }
            }
            ,Sale:{
                nClass:3
                ,hProperties:{
                    id:{bUnique:true,sType:'Number'}
                    ,user_id:{sType:'Number'}
                    ,amount:{sType:'Float',nMax:20,nScale:2}
                }
                ,sAdapterPath:'example/overrides/adapter/Sale.js'
                ,sClassPath:'example/overrides/class/Sale.js'
            }
        }
        ,hStats:{
            users:{
                sDescription:'Total number of new user accounts created during the period.'
                ,sClass:'User'
                ,fnQuery:function(oSelf,dStart,dEnd,App,fnCallback){
                    // This is a mysql query that will return the count for the passed-in period, allowing recreation
                    // of data from mysql in case of redis data problem or building retro-active stats.
                    var sRange = (dStart && dEnd) ? ' AND created >='+dStart.getTime()+' AND created<'+dEnd.getTime() : '';
                    var sSql = 'SELECT COUNT(*) AS nCount FROM UserTbl WHERE '+sRange;
                    App.MySql.execute(null,sSql,null,function(err,res){
                        var nCount =  (res && res.length && res[0].nCount) ? res[0].nCount : 0;
                        fnCallback(err,nCount);
                    });
                }
            }
            ,unique_users:{
                sDescription:'Total number of unique users active during the period.'
                ,fnValidate:function(aParams,fnCallback){
                    // This function makes sure the proper, related object is passed into the AppConfig.trackStat method
                    // and returns a string that will help uniquely identify the stat in Redis.
                    if (!aParams[0] || !aParams[0].sClass == 'User')
                        fnCallback('This stat requires a User object as first param.');
                    else
                        fnCallback(null,aParams[0].getNumKey());
                }
            }
            ,api_requests:{
                sDescription:'Total number of hits to the api, regardless of user.'
                ,fnValidate:function(aParams,fnCallback){
                    // The first param should be the api endpoint path.
                    if (!aParams || !aParams[0])
                        fnCallback('This stat requires an api endpoint string as the first param.');
                    else
                        fnCallback(null,aParams[0]);
                }
            }
            ,hits:{
                sDescription:'Total number of hits, regardless of user or endpoint.'
                ,fnValidate:function(aParams,fnCallback){
                    // This is just a raw count, so return an empty string and the stat tracker will just count everything in one bucket.
                    fnCallback(null,'');
                }
            }
            ,misconfigured_stat:{
                sDescription:'This stat is missing the fnValidate function, and is here for unit testing purposes.'
            }
        }
        ,fnMiddleware:function(req,res,next,App,async) {
            // This is an optional function that will be executed in the api middleware flow.
            // The primary purpose is to allow you to track whatever you want in the api.
            // Of course, you can inject this function in your own web app if you like. But this is here to provide
            // an example of how Nordis supports api endpoint tracking.

            // The preParse method will have already run, setting the following vars inside the req.hNordis hash:
            /**
             * sClass - String name of the class being requested.
             * sAction - String action (save.json, details.json, etc)
             * hQuery - lookup hash derived from the endpoint path which is used to lookup the object.
             * sLookupProperty - the property being used to lookup the object (numeric or string key property name).
             */

            // The following calls could be offloaded to another process, or executed off of the UI thread if desired.
            async.parallel([
                function(callback){
                    App.trackStat('api_requests',[req.hNordis.sClass+'/'+req.hNordis.sAction],callback);
                }
                ,function(callback){
                    App.trackStat('hits',null,callback);
                }
            ],next);
        }
        ,hErrorStrings:{
            500:{
                en:'Malformed request.'
            }
        }
    }
};
