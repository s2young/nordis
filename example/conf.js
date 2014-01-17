/**
 *
 *
 */
module.exports.hSettings = {
    global: {
        sLanguage:'en'
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
                        ,sSample:'1'
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
                    ,follows:{
                        sType:'Collection'
                        ,sClass:'Follow'
                        ,sOrderBy:'rank'
                        ,bReverse:true
                        ,fnQuery:function(oSelf){
                            return {followed_id:oSelf.getKey()}
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
                        '/user/{id}':{
                            sDescription:'Retrieve, update and delete user.'
                            ,hParameters:{
                                id:{
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
                                }
                                ,GET:{
                                    sTitle:'Retrieve a User'
                                    ,sDescription:'You can retrieve any of the \'hExtras\' configured for the class using the hExtras parameter in the GET call. In the following example, we want to retrieve the user\'s \'follows\' collection up to a total of ONE record (nSize:1). On that follower, we want the related follower_user property (which is a User object).\n\n            {"hExtras":{follows:{nSize:1,hExtras:{follower_user:true}}}}'
                                    ,fnApiCallOutput:function(req,AppConfig,fnCallback){
                                        if (fnCallback)
                                            // Nordis has a toHash method as the default serialization for each class, but you can override it here. In this case, we're just going ahead with the default serialization.
                                            fnCallback(null,req.hNordis.oResult.toHash(req.hNordis.hExtras));
                                        else
                                            return req.hNordis.oResult.toHash(req.hNordis.hExtras);
                                    }
                                }
                                ,DELETE:{
                                    sTitle:'Delete a User'
                                }
                            }
                        }
                    }
                }
            }
            ,Follow:{
                hProperties:{
                    id:{
                        sType:'Number',
                        bUnique:true,
                        sSample:'3'
                    }
                    ,followed_id:{
                        sType:'Number'
                        ,sSample:'1'
                    }
                    ,follower_id:{
                        sType:'Number'
                        ,sSample:'2'
                    }
                    ,rank:{
                        sType:'Number'
                        ,sSample:'0'
                    }
                }
                ,nClass:2
                ,hExtras:{
                    followed_user:{
                        sType:'Object'
                        ,sClass:'User'
                        ,aKey:['followed_id','id']
                        ,fnQuery:function(oSelf){
                            return {id:oSelf.get('followed_id')}
                        }
                    }
                    ,follower_user:{
                        sType:'Object'
                        ,sClass:'User'
                        ,aKey:['follower_id','id']
                        ,fnQuery:function(oSelf){
                            return {id:oSelf.get('follower_id')}
                        }
                    }
                }
                ,hApi:{
                    sDescription:'Follow objects are pointers to Users. The initiator of the follow is found on the \'follower_user\' extra, while the recipient is the \'followed_user.\''
                    ,hEndpoints:{
                        '/user/{id}/follows':{
                            sDescription:'Retrieves collection of follows for the passed-in user.'
                            ,hParameters:{
                                id:{
                                    bRequired:true
                                    ,sType:'String'
                                    ,sExample:'Yf8uIoP'
                                    ,sDescription:'String id of the user record. Numeric ids are also supported.'
                                }
                            }
                            ,hVerbs:{
                                GET:{
                                    sTitle:'Retrieve Follow Collection'
                                    ,sDescription:'This api call is an example of how to define a custom function (fnApiCallProcessor) to track stats or check security credentials on an endpoint. Also, this example has a custom output function (fnApiCallOutput) which customizes what the returning document looks like. Both are defined in the config file.'
                                    ,hSample:{sClass:'Follow',aObjects:[{id:3,followed_id:1,follower_id:2,rank:1,follower_user:{id:2,sid:'H0Jd56g6',created:1389625960,updated:1389625960,name:'Joe Follower',email:'follower@gmail.com',referrer_id:'1'}}],nTotal:1}
                                    ,bDisallowExtras:false
                                    ,fnApiCallProcessor:function(req,AppConfig,fnCallback){
                                        AppConfig.trackStat('api_requests',['/user/{id}/follows'],fnCallback);
                                    }
                                    ,fnApiCallOutput:function(req,AppConfig,fnCallback){
                                        // We're going to provide a default hExtras if it's not passed in by the middleware.
                                        req.hNordis.hExtras = (req.hNordis.hExtras) ? req.hNordis.hExtras : {follower_user:true};
                                        // For production use, there will be a callback. The apiary.js script, which produces API docs, does not provide a callback and expects a return statement.
                                        if (fnCallback)
                                            req.hNordis.oResult.loadExtras(req.hNordis.hExtras,function(err){
                                                if (err)
                                                    fnCallback(err);
                                                else
                                                    fnCallback(null,req.hNordis.oResult.toHash(req.hNordis.hExtras));
                                            });
                                        else
                                            return req.hNordis.oResult.toHash(req.hNordis.hExtras);
                                    }
                                }
                            }
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
                ,fnQuery:function(oSelf,dStart,dEnd,AppConfig,fnCallback){
                    // This is a mysql query that will return the count for the passed-in period, allowing recreation
                    // of data from mysql in case of redis data problem or building retro-active stats.
                    var sRange = (dStart && dEnd) ? ' AND created >='+dStart.getTime()+' AND created<'+dEnd.getTime() : '';
                    var sSql = 'SELECT COUNT(*) AS nCount FROM UserTbl WHERE '+sRange;
                    AppConfig.MySql.execute(null,sSql,null,function(err,res){
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
                        fnCallback(null,aParams[0].getKey());
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
            ,misconfigured_stat:{
                sDescription:'This stat is missing the fnValidate function, and is here for unit testing purposes.'
            }
        }
        ,hErrorStrings:{
            500:{
                en:'Malformed request.'
            }
        }
    }
};
