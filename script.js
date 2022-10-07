const scale = require('api')('@scale-ai/v1.1#7n708c4kl8klcbfj');
var fs = require('fs');
const probe = require('probe-image-size');
require('dotenv').config()
scale.auth(process.env.LIVE_KEY)

/**
 * Main function to retrieve tasks, run quality checks, and output quality report into a JSON file 
 */
async function run() {
    let tasks = await retrieveTasks(process.env.PROJECT_NAME, 'completed')
    let qualityReport = {
        errors: [],
        warnings: [],
        success: []
    }

    tasks.forEach(task => {
        const { task_id } = task
        let taskQuality = qualityChecks(task)

        // sort the quality check results by type QualityLabel type
        let annotationErrors = taskQuality.filter(check => check.type === QualityLabels.Error)
        let annotationWarnings = taskQuality.filter(check => check.type === QualityLabels.Warning)
        let annotationSuccess = taskQuality.filter(check => check.type === QualityLabels.Success)

        // compile the quality report
        if (annotationErrors.length > 0) {
            qualityReport.errors.push({ task_id, annotationErrors })
        }
        if (annotationWarnings.length > 0) {
            qualityReport.warnings.push({ task_id, annotationWarnings })
        }
        if (annotationSuccess.length > 0) {
            qualityReport.success.push({ task_id, annotationSuccess })
        }

    })

    console.log('Tasks with Errors: ', qualityReport.errors.length, 'Tasks with Warnings: ', qualityReport.warnings.length, 'Tasks with Success: ', qualityReport.success.length)

    createJSONFile(process.env.FILE_NAME, {
        projectName: process.env.PROJECT_NAME,
        authorName: process.env.AUTHOR_NAME,
        created: new Date(),
        description: 'This file provides a quality report of all completed computer vision tasks. The results are broken down into three categoies - Errors, Warnings, and Success. ' +
            'Errors should be audited for immediate review. Warnings point out task annotations that may need further attention but could also be accurate. Success is the result all a passed quality check.',
        qualityReport
    })
}

/**
 * Execute each of the quality checks 
 */
function qualityChecks(task) {
    const { response, params } = task
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

/*
 * Compares the annotation label to what was instructed in the spec document 
 */
function checkAnnotationType(objectsToAnnotate, annotation) {
    const checkName = 'Annotation Type Check'
    const { label, uuid } = annotation
    if (!objectsToAnnotate.includes(label)) {
        return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: `Annotation label: ${label} does not match input params.object_to_annotate` }
    } else {
        return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
    }
}

/**
 * Check if occlusion matches the annotation instructions
 */
function checkOcclusion(annotation) {
    const { uuid } = annotation
    const { occlusion } = annotation.attributes
    const EXPECTED_OCCLUSION_VALUES = ['0%', '25%', '50%', '75%', '100%'] // as specified in spec doc
    const checkName = 'Occlusion Value Check'
    if (!EXPECTED_OCCLUSION_VALUES.includes(occlusion)) return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: `Occlusion value: ${occlusion} does not match input Annotation Attribute` }
    return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
}

/**
 * Check if truncation matches the annotation instructions
 */
function checkTruncation(annotation) {
    const { uuid } = annotation
    const { truncation } = annotation.attributes
    const EXPECTED_TRUNCATION_VALUES = ['0%', '25%', '50%', '75%', '100%'] // as specified in spec doc
    const checkName = 'Truncation Value Check'
    if (!EXPECTED_TRUNCATION_VALUES.includes(truncation)) return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: `Truncation value: ${truncation} does not match input Annotation Attribute` }
    return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
}

/**
 * Check if background color matches the annotation instructions
 */
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
    ] // as specified in spec doc
    const checkName = 'Background Color Check'
    if (!EXPECTED_BACKGROUND_COLORS.includes(background_color)) return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: `Background color: ${background_color} does not match input params.annotation_attributes.choices` }
    return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
}

/**
 * Check if the bounding box geometry meet the labeling minWidth and minHeight requirements
 */
function checkBoundingBoxLabel({ minWidth, minHeight }, annotation) {
    let { boundingBoxWidth, boundingBoxHeight, uuid } = annotation
    const checkName = 'Bounding Box Label Check'
    if (boundingBoxWidth <= minWidth || boundingBoxHeight <= minHeight) return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: `Bounding Box dimenstions width: ${width}, height: ${height} does not match minWidth: ${minWidth} and minHeight: ${minHeight} requirements` }
    return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
}

/**
 * Check if the bounding box is within the actual dimensions of the image
 */
function checkBoundingBoxSize({ attachment }, annotation) {
    let { imageWidth, imageHeight } = getImageDimensions(attachment)
    let { boundingBoxWidth, boundingBoxHeight, uuid } = annotation
    const checkName = 'Bounding Box Size Check'

    // check if bounding box is the same size or greater than the image
    if (boundingBoxWidth >= imageWidth && boundingBoxHeight >= imageHeight) {
        return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: 'Bounding box is equal to or larger than provided image.' }
    }
    return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
}

/**
 * Check is any part of the bounding box is on the edge of the image. 
 * If it is on the egde of the image then it should have an appropriate truncation value
 */
function checkBoundingBoxTruncation({ attachment }, annotation) {
    let { top, left, uuid } = annotation
    const checkName = 'Bounding Box Truncation Check'
    let { imageWidth, imageHeight } = getImageDimensions(attachment)

    // image edge = every border of the image which is equal to the each corner of the annotated bounding box
    if (top === 0 || left === 0 || top === imageHeight || left === imageWidth) {
        const truncationString = annotation.attributes.truncation
        let truncation = Number(truncationString.slice(0, truncationString.length - 1))
        if (truncation === 0) {
            return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: `Bounding box is on an image edge and not label as truncated with truncation value: ${truncation}.` }
        }
        // arbitrary value of 25 chosen that customer should specifically mention to flag a warning
        else if (truncation > 0 && truncation <= 25) {
            return { type: QualityLabels.Warning, uuid, checkName, checkResultDescription: `Bounding box is on an image edge. Truncation value: ${truncation} might be inaccurate.` }
        }
    }
    return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
}

/**
 * Returns the dimensions (width & height) for a given image. 
 * Using a 3rd party service called prob.
 */
async function getImageDimensions(imageUrl) {
    let result = await probe(imageUrl);
    if (!result) {
        console.error('Error getting Image Dimensions', result)
        return
    }
    return result.width, result.height
}

/**
 * Check annotations for what could be a traffic light.
 * Loosely defining traffic light as a box with an aspect ratio of 1:3.
 * For traffic light candidates, check if they have a background color of other (as outlined in the spec doc).
 */
function checkTrafficLightBackgroundColor(annotation) {
    const { label, uuid } = annotation
    const checkName = 'Traffic Light Background Color Check'

    // filter by label group for what could be a traffic light
    if (label === 'traffic_control_sign') {
        let { width, height } = annotation
        let aspectRatio = width / height
        let { background_color } = annotation.attributes

        // generally assuming traffic lights have an aspect ratio of 1:3
        if (aspectRatio === 1 / 3) {
            if (background_color !== 'other') {
                return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: `Traffic light background color: ${background_color} is inaccurate. Should be labeled other` }
            }
        }
        // assuming labels aren't exactly perfect
        else if (aspectRatio >= (1 / 4 && aspectRatio <= 1 / 2)) {
            if (background_color !== 'other') {
                return { type: QualityLabels.Warning, uuid, checkName, checkResultDescription: `Traffic light background color: ${background_color} might be inaccurate` }
            }
        }
    }
    return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
}

/**
 * Check if construction signs have the correct background color, orange, labeled as specified in the spec doc
 */
function checkConstructionSignBackgroundColor(annotation) {
    const { label, uuid } = annotation
    const checkName = 'Construction Sign Background Color Check'
    if (label === 'construction_sign') {
        let { background_color } = annotation.attributes
        if (background_color !== 'orange') {
            return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: `Construction background color: ${background_color} not labeled as orange` }
        }
    }
    return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
}

/**
 * Check if non visible faces have the correct background color, not_applicable, labeled as specified in the spec doc
 */
function checkNonVisibleFaceBackgroundColor(annotation) {
    const { label, uuid } = annotation
    const checkName = 'Non Visible Face Background Color Check'
    if (label === 'non_visible_face') {
        let { background_color } = annotation.attributes
        if (background_color !== 'not_applicable') {
            return { type: QualityLabels.Error, uuid, checkName, checkResultDescription: `Non Visible Face background color: ${background_color} not labeled as not_applicable` }
        }
    }
    return { type: QualityLabels.Success, uuid, checkName, checkResultDescription: '✅' }
}

/**
 * Fetch and retrieves tasks from Scale
 */
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


/**
 * Creates JSON file
 */
async function createJSONFile(fileName, data) {
    await fs.writeFileSync(fileName, JSON.stringify(data))
    console.log('Quality Report available in: ' + fileName)
}

/**
 * Immutable types of quality labels used for quality report
 */
const QualityLabels = Object.freeze({
    Error: Symbol('error'),
    Warning: Symbol('warning'),
    Success: Symbol('success')
})

run()