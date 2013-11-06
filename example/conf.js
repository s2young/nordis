/**
 * How to read this config file.
 *
 * global - the default environment lives inside 'global' but you can define different environments in your NORDIS_ENV
 * variable that will tell nordis to look for that key in the config file.  For example, I have a 'local' NORDIS_ENV on
 * my box and a local section of the config file.  That way I can use a single config for multiple environments.
 *
 * nSeedID - Nordis uses Redis to dole out 'primary key id' values for every object it creates. This allows you to move
 * your data around without losing primary key integrity.  NOTE: don't ever delete the 'nSeedID' key in Redis! Unless you're
 * willing to lose the
 *
 * aEmergencyEmails - Array of email addresses that should be notified upon any call to the fatal method inside the AppConfig
 * singleton.  Logging methods are available in AppConfig including log, warn, error and fatal.
 *
 * sLogLevel - string that can be any of the following: info, debug, warn, error.  If 'info' is used, all calls to the AppConfig.info
 * method, as well as debug, warn & error, will be printed to the console.
 *
 * hOptions - This is where you find MySql and Redis connection properties.  Also this includes simple Email configuration
 * for sending smtp email (used by fatal method above).
 *
 * hClasses - This is where you define your model.
 */
module.exports.hSettings = {
    global: {
        nSeedID:1000000
        ,aEmergencyEmails:['s2.d.young@gmail.com']
        ,sLogLevel:'info'
        ,hOptions:{
            MySql:{
                sSchema:'nordis',
                sHost:'localhost',
                sUser:'root',
                nMaxConnections:2000,
                nTimeoutMilliseconds:10000,
                bDebugMode:false,
                bSkip:false
            },
            Redis:{
                sWriteServer:'127.0.0.1',
                nWritePort:6379,
                nMaxConnections:2000,
                nTimeoutMilliseconds:30000,
                nReapIntervalMilliseconds:5000,
                bDebugMode:false,
                bSkip:false,
                bPointersOnly:true
            },
            Email:{
                oQuickMail:{
                    host: 'smtp.gmail.com',
                    secureConnection: true,
                    port: 465,
                    auth: {
                        user: 's2.d.young@gmail.com',
                        pass: 'L3xLuth3r_g'
                    }
                }
            }
        }
        ,hClasses:{
            User:{
                aProperties:['nID','sID','sName','sPassword','sEmail','nReferringUserID']
                ,aSecondaryLookupKeys:['sID','sEmail']
                ,nLengthOfsID:36
                ,nClass:1
                ,hExtras:{
                    nPoints:{sType:'Increment'}
                    ,cFriends:{
                        sType:'Collection'
                        ,sClass:'Friend'
                        ,sOrderBy:'nRank'
                        ,bReverse:true
                        ,fnQuery:function(oSelf,App){
                            return {nUserID:oSelf.get('nID')}
                        }
                    }
                    ,oReferringUser:{
                        sType:'Object'
                        ,sClass:'User'
                        ,aKey:['nReferringUserID','nID']
                        ,fnQuery:function(oObj,App){
                            return {nID:oObj.get('nReferringUserID')}
                        }
                    }
                }
            }
            ,Friend:{
                aProperties:['nUserID','nFriendUserID','nRank']
                ,nClass:2
                ,hExtras:{
                    oUser:{
                        sType:'Object'
                        ,sClass:'User'
                        ,aKey:['nUserID','nID']
                        ,fnQuery:function(oSelf,App){
                            return {nID:oSelf.get('nUserID')}
                        }
                    }
                    ,oFriendUser:{
                        sType:'Object'
                        ,sClass:'User'
                        ,aKey:['nFriendUserID','nID']
                        ,fnQuery:function(oSelf,App){
                            return {nID:oSelf.get('nFriendUserID')}
                        }
                    }
                }
            }
        }
        ,hClassMap:{
            1:'User'
            ,2:'Friend'
        }
    }
};
