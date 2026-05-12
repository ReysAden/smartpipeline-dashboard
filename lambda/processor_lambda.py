import json
import urllib.parse
import boto3
import time
from datetime import datetime

sns = boto3.client("sns")
rekognition = boto3.client("rekognition")
textract = boto3.client("textract")
bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")
s3 = boto3.client("s3")

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("smart-pipeline-results")

TOPIC_ARN = "arn:aws:sns:us-east-1:183631312511:smart-pipeline-topic"


def summarize_text(text_content):

    try:

        response = bedrock.invoke_model(
            modelId="amazon.titan-text-express-v1",
            body=json.dumps({
                "inputText": f"""
Summarize this uploaded text file in 3 short bullet points.

Text:
{text_content}
"""
            }),
            contentType="application/json",
            accept="application/json"
        )

        result = json.loads(response["body"].read())

        return result["results"][0]["outputText"]

    except Exception as e:

        print("Bedrock failed:", str(e))

        return text_content[:500]


def read_pdf_with_textract(bucket, key):

    start_response = textract.start_document_text_detection(
        DocumentLocation={
            "S3Object": {
                "Bucket": bucket,
                "Name": key
            }
        }
    )

    job_id = start_response["JobId"]

    for _ in range(20):

        response = textract.get_document_text_detection(
            JobId=job_id
        )

        status = response["JobStatus"]

        if status == "SUCCEEDED":

            lines = []

            for block in response["Blocks"]:

                if block["BlockType"] == "LINE":

                    lines.append(block["Text"])

            return "\n".join(lines[:20])

        if status == "FAILED":

            return "PDF Textract processing failed."

        time.sleep(3)

    return "PDF Textract job started but did not finish in time."


def lambda_handler(event, context):

    record = event["Records"][0]

    bucket = record["s3"]["bucket"]["name"]

    key = urllib.parse.unquote_plus(
        record["s3"]["object"]["key"]
    )

    key_lower = key.lower()

    file_type = "unknown"
    processor_used = "None"
    result_text = ""

    print(f"Bucket: {bucket}")
    print(f"File: {key}")

    # PDF processing
    if key_lower.endswith(".pdf"):

        file_type = "document"
        processor_used = "Textract"

        result_text = read_pdf_with_textract(
            bucket,
            key
        )

    # Image processing
    elif key_lower.endswith((".jpg", ".jpeg", ".png")):

        # Receipt / document image
        if any(
            word in key_lower
            for word in [
                "receipt",
                "invoice",
                "scan",
                "document"
            ]
        ):

            file_type = "document-image"
            processor_used = "Textract"

            response = textract.detect_document_text(
                Document={
                    "S3Object": {
                        "Bucket": bucket,
                        "Name": key
                    }
                }
            )

            lines = []

            for block in response["Blocks"]:

                if block["BlockType"] == "LINE":

                    lines.append(block["Text"])

            result_text = "\n".join(lines[:15])

        # Normal image
        else:

            file_type = "image"
            processor_used = "Rekognition"

            response = rekognition.detect_labels(
                Image={
                    "S3Object": {
                        "Bucket": bucket,
                        "Name": key
                    }
                },
                MaxLabels=10,
                MinConfidence=75
            )

            labels = [
                label["Name"]
                for label in response["Labels"]
            ]

            result_text = ", ".join(labels)

    # Text processing
    elif key_lower.endswith((".txt", ".csv")):

        file_type = "text"
        processor_used = "Bedrock"

        obj = s3.get_object(
            Bucket=bucket,
            Key=key
        )

        text_content = obj["Body"].read().decode(
            "utf-8",
            errors="ignore"
        )[:3000]

        result_text = summarize_text(
            text_content
        )

    table.put_item(
        Item={
            "file_id": key,
            "bucket": bucket,
            "file_type": file_type,
            "processor_used": processor_used,
            "result": result_text,
            "processed_at": datetime.utcnow().isoformat()
        }
    )

    sns.publish(
        TopicArn=TOPIC_ARN,
        Subject="SmartPipeline File Processed",
        Message=f"Processed: {key}"
    )

    return {
        "statusCode": 200,
        "body": json.dumps("Processing complete")
    }