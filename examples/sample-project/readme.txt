This directory contains the most simple project I can devise for a working, stand-alone, nordis-based app. Here is how you can get it working on your machine:

1. Create an empty folder, and drop these files into it. Run 'npm install' on the directory.

2. Look at the conf.js and customize the MySql and Redis sections with your own instance settings. Create an empty schema in your MySql db and update the conf.

3. From the command line, run 'node test.js'  - you should see a User record being written to your test schema. The log level is set to 'silly' in the conf.js which should result in you seeing all the sql statements including the creation of the table and columns.

