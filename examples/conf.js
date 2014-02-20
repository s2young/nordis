/**
 * This configuration file is the heart of a Nordis-based app. It defines database connections, log levels,
 * your data model, and any API endpoints you want to expose to users.
 */
var Base; // We're going to need the Base class is api override functions below.
var Collection; // And Collection.

module.exports.hSettings = {
    global: {
        sLanguage:'en'
        ,sLogLevel:'warn'
        ,bTraceMode:false
        ,hOptions:{
            MySql:{
                default:{
                    sSchema:'nordis',
                    sHost:'localhost',
                    sUser:'root',
                    sPassword:'',
                    nMaxConnections:20,
                    nTimeoutMilliseconds:10000,
                    bDebugMode:false,
                    bSkip:false
                }
                ,secondary:{
                    sSchema:'nordis_secondary',
                    sHost:'localhost',
                    sUser:'root',
                    sPassword:'',
                    nMaxConnections:10,
                    nTimeoutMilliseconds:10000,
                    bDebugMode:false,
                    bSkip:false
                }
            },
            Redis:{
                default:{
                    sHost:'127.0.0.1',
                    nPort:6379
                }
                ,statsdb:{
                    sHost:'127.0.0.1'
                    ,nPort:6379
                    ,nDb:1
                }
            }
        }
        ,hApi:{
            sTitle:'Nordis Sample API'
            ,sDescription:'This API is a simple output of the classes provided in this simple configuration example. No authentication is required for any endpoint, but real-world examples should include it.'
            ,sHost:'http://api.example.com'
            ,hEndpoints:{
                '/process_stats':{
                    sDescription:'Custom endpoint for the demo app to trigger stat processing method.'
                    ,sClass:'Stat'
                    ,hVerbs:{
                        POST:{
                            fnApiCallProcessor:function(req,AppConfig,callback){
                                AppConfig.processStats(callback);
                            }
                        }
                    }
                }
                ,'/userlist':{
                    sDescription:'Again, no security implemented here. Just a demo of a collection and its paging capabilities.'
                    ,sClass:'User'
                    ,hVerbs:{
                        GET:{
                            sTitle:'Retrieve All Users'
                            ,fnApiCallProcessor:function(req,AppConfig,callback) {
                                if (!callback)
                                    return {aObjects:[],sClass:'User'};
                                else {
                                    if (!Collection) Collection = require(AppConfig.NORDIS_ENV_ROOT_DIR+'/lib/Collection'); // You would use require('nordis').Collection;
                                    new Collection({
                                        sClass:'User'
                                        ,hQuery:{sid:'IS NOT NULL'}
                                        ,nSize:req.query.nSize||20
                                        ,nFirstID:req.query.nFirstID||null
                                    },callback);
                                }
                            }
                        }
                    }
                }
            }
        }
        ,hClasses:{
            User:{
                hProperties:{
                    id:{
                        sType:'Number'
                        ,bPrimary:true
                        ,sSample:'1'
                    }
                    ,sid:{
                        sType:'String'
                        ,bSecondary:true
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
                        ,bRequired:true
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
                        ,bRequired:true
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
                                    ,fnApiCallProcessor:function(req,AppConfig,callback){
                                        // Locate the user.
                                        if (!Base) Base = require(AppConfig.NORDIS_ENV_ROOT_DIR+'/lib/Base'); // You would use require('nordis').Base;
                                        var email = (req.body.email) ? req.body.email.toLowerCase() : '';
                                        Base.lookup({sClass:'User',hQuery:{email:email,name:req.body.name}},function(err,user){
                                            if (err)
                                                callback(err);
                                            else {
                                                // This will overwrite an existing user if found in the db. You would implement
                                                // checks here for security stuff.
                                                user.setData({
                                                    email:email
                                                    ,name:req.body.name
                                                    ,password:req.body.password // In a real app, I would hash this.
                                                });
                                                user.save(callback);
                                            }
                                        });
                                    }
                                }
                                ,GET:{
                                    sTitle:'Retrieve a User'
                                    ,sDescription:'You can retrieve any of the \'hExtras\' configured for the class using the hExtras parameter in the GET call. In the following example, we want to retrieve the user\'s \'follows\' collection up to a total of ONE record (nSize:1). On that follower, we want the related follower_user property (which is a User object).\n\n            {"hExtras":{follows:{nSize:1,hExtras:{follower_user:true}}}}'
                                    ,fnApiCallOutput:function(req,AppConfig,callback){
                                        if (callback) {
                                            AppConfig.trackStat('api_requests',['/user/{id}']);
                                            AppConfig.trackStat('hits',[req.hNordis.sPath]);
                                            // Nordis has a toHash method as the default serialization for each class, but you can override it here. In this case, we're just going ahead with the default serialization.
                                            callback(null,req.hNordis.oResult.toHash(req.hNordis.hExtras));
                                        } else
                                            return req.hNordis.oResult.toHash(req.hNordis.hExtras);
                                    }
                                }
                                ,DELETE:{
                                    sTitle:'Delete a User'
                                    ,fnApiCallOutput:function(req,AppConfig,callback) {
                                        if (!req.hNordis.oResult.getKey())
                                            callback('User not found.');
                                        else
                                            req.hNordis.oResult.delete(callback);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            ,Follow:{
                hProperties:{
                    id:{
                        sType:'Number'
                        ,bPrimary:true
                        ,sSample:'3'
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
                                    ,fnApiCallProcessor:function(req,AppConfig,callback){
                                        // Setting default extras for this endpoint.  This is where you could completely ignore and/or override what the api user is asking for.
                                        req.hNordis.hExtras = (req.hNordis.hExtras) ? req.hNordis.hExtras : {follows:{hExtras:{follower_user:true}}};
                                        AppConfig.trackStat('api_requests',['/user/{id}/follows'],callback);
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
                    id:{bPrimary:true,sType:'Number'}
                    ,user_id:{sType:'Number'}
                    ,amount:{sType:'Decimal',nMax:20,nScale:2}
                }
                ,sAdapterPath:'examples/overrides/adapter/Sale.js'
                ,sClassPath:'examples/overrides/class/Sale.js'
            }
        }
        ,hStats:{
            sDbAlias:'statsdb'
//            users:{
//                sDescription:'Total number of new user accounts created during the period.'
//                ,fnQuery:function(oSelf,dStart,dEnd,AppConfig,callback){
//                    // This is a mysql query that will return the count for the passed-in period, allowing recreation
//                    // of data from mysql in case of redis data problem or building retro-active stats.
//                    var sRange = (dStart && dEnd) ? ' AND created >='+dStart.getTime()+' AND created<'+dEnd.getTime() : '';
//                    var sSql = 'SELECT COUNT(*) AS nCount FROM UserTbl WHERE '+sRange;
//                    AppConfig.MySql.execute(null,sSql,null,function(err,res){
//                        var nCount =  (res && res.length && res[0].nCount) ? res[0].nCount : 0;
//                        callback(err,nCount);
//                    });
//                }
//            },
            ,unique_users:{
                sDescription:'Total number of unique users active during the period.'
                ,fnValidate:function(aParams,callback){
                    // This function makes sure the proper, related object is passed into the AppConfig.trackStat method
                    // and returns a string that will help uniquely identify the stat in Redis.
                    if (!aParams[0] || !aParams[0].sClass == 'User')
                        callback('This stat requires a User object as first param.');
                    else
                        callback(null,aParams[0].getKey());
                }
            }
            ,hits:{
                sDescription:'Total number of hits to the web, regardless of user.'
                ,fnValidate:function(aParams,callback){
                    // The first param should be the api endpoint path.
                    if (!aParams || !aParams[0])
                        callback('This stat requires an url path string as the first param.');
                    else
                        callback(null,aParams[0]);
                }
            }
            ,api_requests:{
                sDescription:'Total number of hits to the api, regardless of user.'
                ,fnValidate:function(aParams,callback){
                    // The first param should be the api endpoint path.
                    if (!aParams || !aParams[0])
                        callback('This stat requires an api endpoint string as the first param.');
                    else
                        callback(null,aParams[0]);
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
