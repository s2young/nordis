module.exports.hSettings = {
    global: {
        nStartingID:1000000
        ,aEmergencyEmails:['stuart@gobaengage.com']
        ,hConstants:{
            sLogLevel:'debug',
            sServerTZ:'America/Chicago'
        }
        ,hOptions:{
            MySql:{
                sSchema:'nordis_dev',
                sHost:'10.224.5.252',
                sUser:'root',
                sPass:'zat{blos0Fru',
                nMaxConnections:2000,
                nTimeoutMilliseconds:10000,
                bDebugMode:true
            },
            Redis:{
                sWriteServer:'127.0.0.1',
                nWritePort:6379,
                nMaxConnections:2000,
                nTimeoutMilliseconds:30000,
                nReapIntervalMilliseconds:5000,
                bDebugMode:true
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
        ,hAppSettings:{
            agewize:{
                nPort:2000,
                nSessionLength:864000
            }
        }
        ,hClasses:{
            User:{
                aProperties:['sID','sFirstName','sLastName','sPassword','sEmail','nBirthday','nCreated','nUpdated']
                ,hExtras:{
                    cFriends:{
                        sType:'Collection'
                        ,sClass:'User'
                        ,fnQuery:function(){

                        }
                    }
                    ,cTiles:{
                        sType:'Collection'
                        ,sClass:'Tile'
                        ,sSortBy:'nUpdated'
                        ,bReverse:'true'
                        ,fnQuery:function(oObj,App){
                            return {nUserID:oObj.get('nID')}
                        }
                    }

                }
            }
            ,Tile:{
                aProperties:['sID','nUserID','nObjectClass','nObjectID','nType','nCreated','nUpdated']
                ,nType:'Public or private'
                ,cComments:{
                    sType:'Collection'
                    ,sClass:'Comment'
                    ,fnQuery:function(oObj,App){
                        return {nObjectID:oObj.get('nID')}
                    }
                }
            }
            ,Comment:{
                aProperties:['sID','nUserID','sMessage','nCreated','nUpdated']
                ,hExtras:{
                    cCopies:{
                        sType:'Collection'
                        ,sClass:'CarbonCopy'
                        ,fnQuery:function(oObj,App){
                            return {nCommentID:oObj.get('nID')}
                        }
                    }
                }
            }
            ,Post:{
                aProperties:['sID','sMessage','nCreated','nUpdated']
            }
            ,Visit:{
                aProperties:['sID','nDate','sProvider','sLocation','sNotes']
            }
            ,Doctor:{}
            ,Provider:{}
            ,ContentProvider:{}
            ,Article:{
                aProperties:['sID','sImage','sTitle','sBody','sUrl','nContentProviderID','nCreated','nUpdated']
            }
            ,Medication:{
                aProperties:['sID','sTitle','sDosage','sFrequency','sProvider','sNotes']
            }
            ,Supplement:{
                aProperties:['sID','sTitle','sDosage','sFrequency','sProvider','sNotes']
            }
            ,CarbonCopy:{
                aProperties:['sID','nUserID','nCommentID']
            }
        }
        ,hClassMap:{
            1:'User',2:'Tile',3:'Comment',4:'Post',5:'Visit',6:'Article',7:'Medication',8:'Supplement',9:'CarbonCopy'
        }
        ,hAPIHelper:{
            user:'User'
            ,tile:'Tile'
            ,comment:'Comment'
            ,post:'Post'
            ,visit:'Visit'
            ,article:'Article'
            ,medication:'Medication'
            ,supplement:'Supplement'
            ,'carboncopy':'CarbonCopy'
        }
    }
};
