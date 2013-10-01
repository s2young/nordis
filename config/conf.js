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
                aProperties:[]
            }
        }
        ,hClassMap:{
            1:'User'
        }
        ,hAPIHelper:{
            user:'User'
        }
    }
};
