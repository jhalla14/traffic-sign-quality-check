# Automated Quality Check for Traffic Signs

This project performs various quaity checks for annotationed tasks returned from Scale's Computer Vision API. Since some annotations are done by humans, these quality checks will surface any Errors, and Warnings that users might want to investigate further before proceeding with training their ML models.

The main file is `script.js`. This script will output a summary of the quality checks as a Quality Report as `qualityReport.json`. 

## Run Instructions
```
1. git clone 
2. Create .env file. Use the env.example file for reference
2. npm i
3. node script.js
```

## Quality Report Structure
The `qualityReport.json` file is structured into three distinct cateogories - *Errors, Warnings, Success*. Each section groups their resepective error/ warning/ success by task (uuid). Each task then provides the assoicated annotation's uuid.

**Errors**

Errors are tasks that have been annotated incorrectly and should be first to review

**Warnings**

Warnings are tasks that may or may not be incorrect depending on your specific requirements. Either way they deserve a second look.

**Success**

Success details the output of a successful quality check.

## Project Requirements
- [Scale AI Account & API Key](https://scale.com/)

## Known Errors
Occasionally the `getImageDimensions()` will throw an intermittent error below when fetching the URL of a provided image.

```
Error: getaddrinfo ENOTFOUND observesign.s3-us-west-2.amazonaws.com
    at GetAddrInfoReqWrap.onlookup [as oncomplete] (node:dns:109:26) {
  errno: -3008,
  code: 'ENOTFOUND',
  syscall: 'getaddrinfo',
  hostname: 'observesign.s3-us-west-2.amazonaws.com'
}
```

If you experience this behavior, rerun the sciprt. In the future, I would change this dependency to use another library or rebuild an image fetching function from stratch.