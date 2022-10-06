const scale = require('api')('@scale-ai/v1.1#7n708c4kl8klcbfj');
var fs = require('fs');
const probe = require('probe-image-size');
require('dotenv').config()

const PROJECT_NAME = 'Traffic Sign Detection'
const FILE_NAME = 'qualityReport.json'
const LIVE_KEY = process.env.LIVE_KEY
scale.auth(LIVE_KEY)

async function run() {
    let tasks = await retrieveTasks(PROJECT_NAME, 'completed')
    let qualityReport = {
        errors: [],
        warnings: [],
        success: []
    }

    tasks.forEach(task => {
        const { task_id } = task
        let taskQuality = qualityChecks(task)

        let annotationErrors = taskQuality.filter(check => check.type === QualityLabels.Error) 
        let annotationWarnings = taskQuality.filter(check => check.type === QualityLabels.Warning)
        let annotationSuccess = taskQuality.filter(check => check.type === QualityLabels.Success)

        if (annotationErrors.length > 0) {
            qualityReport.errors.push({task_id, annotationErrors})
        }
        if (annotationWarnings.length > 0) {
            qualityReport.warnings.push({task_id, annotationWarnings})
        }
        if (annotationSuccess.length > 0) {
            qualityReport.success.push({task_id, annotationSuccess})
        }

    })

    console.log('Tasks w/ Errors ', qualityReport.errors.length, 'Tasks w/ Warnings ', qualityReport.warnings.length, 'Tasks w/Success ', qualityReport.success.length)

    createJSONFile(FILE_NAME, {
        projectName: PROJECT_NAME,
        description: 'Task Quality Report',
        qualityReport
    })
}

function qualityChecks(task) {
    const { response, params } = task
    // loop through the annotations of each task
    if (response.annotations) {
        let qualityChecks = []

        response.annotations.forEach(annotation => {
            qualityChecks.push(checkAnnotationType(params.objects_to_annotate, annotation))
            qualityChecks.push(checkOcclusion(annotation))
            qualityChecks.push(checkTruncation(annotation))
            qualityChecks.push(checkBackgroundColor(annotation))
            qualityChecks.push(checkBoundingBoxLabel(params, annotation))
            qualityChecks.push(checkBoundingBoxSize(params, annotation))
            qualityChecks.push(checkBoundingBoxTruncation(params, annotation))
            qualityChecks.push(checkTrafficLightBackgroundColor(annotation))

            qualityChecks.push(checkConstructionSignBackgroundColor(annotation))
            qualityChecks.push(checkNonVisibleFaceBackgroundColor(annotation))
        })
        return qualityChecks
    }
}

/* Compares the annotation label to what was inscructed in the spec document */
function checkAnnotationType(objectsToAnnotate, annotation) {
    const checkName = 'Annotation Type Check'
    const { label, uuid } = annotation
    if (!objectsToAnnotate.includes(label)) {
        // error
        return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: `Annotation label: ${label} does not match input params.object_to_annotate` }
    } else {
        //success
        return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
    }
}
/*
Attribute Checks
- check if attributes are over/ under particular values that result in a warning or an error
(occulsion, truncation, background_color)
*/

function checkOcclusion(annotation) {
    const { uuid } = annotation
    const { occlusion } = annotation.attributes
    const EXPECTED_OCCLUSION_VALUES = ['0%', '25%', '50%', '75%', '100%']
    const checkName = 'Occlusion Value Check'
    if (!EXPECTED_OCCLUSION_VALUES.includes(occlusion)) return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: `Occlusion value: ${occlusion} does not match input Annotation Attribute` }
    return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
}

function checkTruncation(annotation) {
    const { uuid } = annotation
    const { truncation } = annotation.attributes
    const EXPECTED_TRUNCATION_VALUES = ['0%', '25%', '50%', '75%', '100%']
    const checkName = 'Truncation Value Check'
    if (!EXPECTED_TRUNCATION_VALUES.includes(truncation)) return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: `Truncation value: ${truncation} does not match input Annotation Attribute` }
    return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }

}

function checkBackgroundColor(annotation) {
    const { uuid } = annotation
    const { background_color } = annotation.attributes
    const EXPECTED_BACKGROUND_COLORS = [
        'white',
        'yellow',
        'red',
        'orange',
        'green',
        'blue',
        'other',
        'not_applicable'
    ]
    const checkName = 'Background Color Check'
    if (!EXPECTED_BACKGROUND_COLORS.includes(background_color)) return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: `Background color: ${background_color} does not match input params.annotation_attributes.choices` }
    return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
}

/*
    Check if the bounding box geometry meet the labeling minWidth and minHeight requirements
*/
function checkBoundingBoxLabel({ minWidth, minHeight }, annotation) {
    let { boundingBoxWidth, boundingBoxHeight, uuid } = annotation
    const checkName = 'Bounding Box Label Check'
    if (boundingBoxWidth <= minWidth || boundingBoxHeight <= minHeight) return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: `Bounding Box dimenstions width: ${width}, height: ${height} does not match minWidth: ${minWidth} and minHeight: ${minHeight} requirements` }
    return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
}

/*
    Check if the bounding box is within the actual dimensions of the image
*/

function checkBoundingBoxSize({ attachment }, annotation) {
    let { imageWidth, imageHeight } = getImageDimensions(attachment)
    let { boundingBoxWidth, boundingBoxHeight, uuid } = annotation
    const checkName = 'Bounding Box Size Check'

    // check if bounding box is the same size or greater than the image
    if (boundingBoxWidth >= imageWidth && boundingBoxHeight >= imageHeight) {
        return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: 'Bounding box is equal to or larger than provided image.' }
    }

    // check if at least one side is larger than the image
    // if (boundingBoxWidth >= imageWidth || boundingBoxHeight >= imageHeight) {
    //     //check truncation
    //     // if truncation is 0 = error, truncation = 50 => warning
    //     const { truncationString } = annotation.attributes
    //     let truncation = Number(truncationString.slice(0, truncationString.length - 1))

    //     if (truncation === 0) {
    //         return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: 'Truncation value is incorrect.' }
    //     } else if (truncation > 0 && truncation < 50) {
    //         return { type: QualityLabels.Warning, uuid, checkName, checkResultDescription: `Provided truncation value ${truncation} might be inaccurate`}
    //     }
    // }
    return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
}

/*
    Chekc is any part of the bounding box is on the edge of the image. 
    If it is on the egde of the image then it should have an appropriate truncation value
*/

function checkBoundingBoxTruncation({ attachment }, annotation) {
    let { top, left, uuid } = annotation
    const checkName = 'Bounding Box Truncation Check'
    let { imageWidth, imageHeight } = getImageDimensions(attachment)
    if (top === 0 || left === 0 || top === imageHeight || left === imageWidth) {
        const truncationString = annotation.attributes.truncation
        let truncation = Number(truncationString.slice(0, truncationString.length - 1))
        if (truncation === 0) {
            return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: `Bounding box is on an image edge and not label as truncated with truncation value: ${truncation}.` }
        } else if (truncation > 0 && truncation <= 25) {
            return { type: QualityLabels.Warning, uuid, checkName, checkResultDescription: `Bounding box is on an image edge. Truncation value: ${truncation} might be inaccurate.` }
        }
    }
    return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
}

async function getImageDimensions(imageUrl) {
    let result = await probe(imageUrl);
    if (!result) {
        console.error('Error getting Image Dimensions', result)
        return
    }
    return result.width, result.height
}

/* Check if what's tagged as a traffic like has the following conditions
 1. has a background color of other
 2. has a bounding box ratio of 3:1
*/
function checkTrafficLightBackgroundColor(annotation) {
    const { label, uuid } = annotation
    const checkName = 'Traffic Light Background Color Check'
    if (label === 'traffic_control_sign') {
        let { width, height } = annotation
        let aspectRatio = width / height
        let { background_color } = annotation.attributes

        if (aspectRatio === 1 / 3) {
            if (background_color !== 'other') {
                return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: `Traffic light background color: ${background_color} is inaccurate. Should be labeled other` }
            }
        } else if (aspectRatio >= (1 / 4 && aspectRatio <= 1 / 2)) {
            // assuming labels aren't exactly perfect
            if (background_color !== 'other') {
                return { type: QualityLabels.Warning, uuid, checkName, checkResultDescription: `Traffic light background color: ${background_color} might be inaccurate` }
            }
        }

    }
    return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
}

function checkConstructionSignBackgroundColor(annotation) {
    const {label, uuid} = annotation
    const checkName = 'Construction Sign Background Color Check'
    if (label === 'construction_sign') {
        let { background_color } = annotation.attributes
        if (background_color !== 'orange') {
            return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: `Construction background color: ${background_color} not labeled as orange` }
        }
    }
    return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
}

function checkNonVisibleFaceBackgroundColor(annotation) {
    const {label, uuid} = annotation
    const checkName = 'Non Visible Face Background Color Check'
    if (label === 'non_visible_face') {
        let { background_color } = annotation.attributes
        if (background_color !== 'not_applicable') {
            return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: `Non Visible Face background color: ${background_color} not labeled as not_applicable` }
        }
    }
    return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
}

async function retrieveTasks(project, status) {
    return scale.listMultipleTasks({
        project,
        status
    })
        .then(res => {
            return res.docs
        })
        .catch(err => console.error(err))
}

async function createJSONFile(fileName, data) {
    let result = await fs.writeFileSync(fileName, JSON.stringify(data))
    console.log(result)
    if (result) {
        console.log('succesfully created: ' + fileName)
    } else {
        console.error(result)
    }
}

const QualityLabels = Object.freeze({
    Error: Symbol('error'),
    Warning: Symbol('warning'),
    Success: Symbol('success')
})

run()

/*
Potential quality checks

- amount of time for the check to be completed
- if a sign should be broken in two -> determine median box size for a type of sign and compare?
- check background color of the given type of sign to what is expected for that type of sign
- check if the size of the box is the same aspect ratio for that type of sign

Label Checks
- check if labels provided are the same as the labels expected (traffic_control_sign, construction_sign, information_sign, policy_sign, non_visible_face)

Attribute Checks
- check if attributes are over/ under particular values that result in a warning or an error
(occulsion, truncation, background_color)

Common Error Checks
Free Standing

Commerical Actiivities/ Events

Individually Labeled Signs

Traffic Lights Color Attribute is Other
- if traffic light - look at actual background color versus the expected label of "other"


 */

