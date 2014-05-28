var Base;var Collection;

module.exports.hSettings = {
    global: {
        sLogLevel:'silly'
        ,hOptions:{
            MySql:{
                default:{
                    sSchema:'your_default_schema',
                    sHost:'255.255.255.0',
                    sUser:'root',
                    sPass:',',
                    nMaxConnections:150
                }
            },
            Redis:{
                sHost:'127.0.0.1',
                nPort:6379
            }
        }
        ,hClasses:{
            User:{
                nClass:1
                ,hProperties:{
                    sid:{sType:'String',bPrimary:true,nLength:'36',sSample:'YT8iHhr7YT8YT8iHhr7YT8iHhr7YTiHhr7YT'}
                    ,created:{sType:'Timestamp',bOnCreate:true,sSample:'1389625960'}
                    ,updated:{sType:'Timestamp',bOnUpdate:true,sSample:'1389625960'}
                    ,name:{sType:'String'}
                    ,email:{sType:'String'}
                    ,balance:{sType:'Decimal',nMax:7,nScale:2}
                    ,type:{
                        sType:'Number'
                            ,hOptions:{
                            Default:0
                                ,Admin:100
                                ,SuperAdmin:1000
                        }
                    }
                }
            }
        }
    }
};
